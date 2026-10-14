import type {
  EntityId,
  KnowledgeResourceId,
  SpaceId,
} from '@workspace/entity-id';
import type { RefusedServerRow } from './server-rows.js';
import type { GraphSyncTableName } from './tables.js';

/**
 * The seams of graph row replication, as interfaces.
 *
 * The engine is written entirely against these: what the server looks like
 * (`GraphRowTransport`), and what the local replica can do (`GraphReplica`,
 * satisfied structurally by the persistence package's ledger + replica writer
 * + repository). Production wires PostgREST behind the transport and PGlite
 * behind the replica; the tests wire a real Postgres — carrying the deployed
 * schema's own guards — behind the SAME transport interface, so the protocol
 * runs against something that can actually refuse it.
 *
 * The authority asymmetry with document sync is the whole reason this is a
 * separate engine: for CRDT bytes the document converges and the server only
 * stores, while for graph rows the SERVER is the sole authority and a local
 * write is a proposal until it accepts it.
 */

/**
 * A row as the transport decodes it: server column names to values. Its id
 * columns have been checked against the kinds its table declares, so `id` is
 * an id of the table's own kind (which kind depends on the table, hence the
 * general type).
 */
export type RowRecord = Record<string, unknown> & { id: EntityId };

/**
 * One write the push planner derives from a journaled op. Three shapes, all
 * idempotent — which is what makes at-least-once replay safe with no dedup
 * machinery anywhere:
 *
 *   * `upsert` — insert or overwrite on a natural key (create, edge move,
 *     per-user state);
 *   * `patch`  — write named columns of matched rows (rename, status, trash,
 *     restore, reorder);
 *   * `delete` — remove matched rows (purge, unlink). A second delivery
 *     matches nothing and is a no-op.
 *   * `rpc`    — one server function carrying a multi-row command the server
 *     must apply atomically (the canonical move). Idempotent by the
 *     function's own contract: replaying it re-asserts the same end state.
 */
export type ServerWrite =
  | {
      kind: 'upsert';
      table: GraphSyncTableName;
      row: Record<string, unknown>;
      /** Comma-separated conflict-target columns (the natural key). */
      onConflict: string;
      /** True: a colliding row is left exactly as it is (create semantics). */
      ignoreDuplicates?: boolean;
    }
  | {
      kind: 'patch';
      table: GraphSyncTableName;
      match: Record<string, unknown>;
      values: Record<string, unknown>;
    }
  | {
      kind: 'delete';
      table: GraphSyncTableName;
      match: Record<string, unknown>;
    }
  | {
      kind: 'rpc';
      fn: string;
      args: Record<string, unknown>;
    };

/**
 * Why a server write failed. The distinction is the entire failure policy:
 *
 *   * `refused` — the server evaluated the write and said no (access, a
 *     guard trigger, a validation error, the cycle check). The op can never
 *     succeed; it is reconciled away and the affected rows are re-pulled.
 *   * `unavailable` — the write never got a verdict (offline, timeout, 5xx).
 *     The op stays in the journal and is retried; dropping it would lose a
 *     change the user made.
 *
 * Collapsing these two would either discard work on a flaky network or
 * retry a refusal forever, so the transport is required to classify.
 */
export type WriteFailureKind = 'refused' | 'unavailable';

export class GraphWriteError extends Error {
  constructor(
    readonly failure: WriteFailureKind,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GraphWriteError';
  }
}

export interface PullPage {
  /** The rows of the page that can be applied. */
  rows: RowRecord[];
  /**
   * Rows of the page that were refused, each on its own. They count toward
   * the page like any other row: the caller pages past them and moves its
   * cursor over them, and reports them.
   */
  refused: RefusedServerRow[];
  /**
   * True when the server had more rows than the page limit. The caller pulls
   * again from the advanced watermark rather than assuming one page is the
   * whole catch-up.
   */
  hasMore: boolean;
}

/** The server, as the engine sees it. Every call runs under the user's own identity. */
export interface GraphRowTransport {
  /**
   * Rows of one table in one space changed at or after `since` (null = the
   * whole visible set), oldest first (id as tiebreaker), at most `limit`
   * rows, skipping the first `offset`. The offset is how one catch-up pass
   * pages: equal timestamps are common (bulk imports, cascades), so paging
   * by watermark alone could never get past a page of identical instants.
   */
  pullSince(
    table: GraphSyncTableName,
    spaceId: SpaceId,
    since: Date | null,
    limit: number,
    offset: number
  ): Promise<PullPage>;

  /**
   * Every id of one table the server shows this user in this space — the
   * inventory the disappearance diff compares against. Ids only: it is a
   * sweep, not a fetch.
   */
  inventory(table: GraphSyncTableName, spaceId: SpaceId): Promise<EntityId[]>;

  /**
   * Rows tied to specific nodes, whatever their timestamp — the targeted
   * re-pull after a refusal, which must not wait for a watermark that has
   * already moved past the rows it needs to correct.
   */
  pullByNodes(
    table: GraphSyncTableName,
    spaceId: SpaceId,
    nodeIds: readonly KnowledgeResourceId[]
  ): Promise<{ rows: RowRecord[]; refused: RefusedServerRow[] }>;

  /**
   * Apply one write. Throws `GraphWriteError` classified as `refused` or
   * `unavailable`; anything else is treated as unavailable (retry) because
   * assuming a refusal would throw the user's change away on a bug.
   */
  write(write: ServerWrite): Promise<void>;

  /**
   * A nudge that rows may have changed in this space — never the delivery
   * itself. Payloads are ignored: a dropped nudge costs latency, the
   * heartbeat of whoever composes the engine makes catch-up inevitable.
   * `onDelete` fires for a deletion nudge, worth an inventory sweep now
   * rather than at the next full pass. `onStatus` says whether the channel
   * is subscribed (true) or not (false: an error, a timeout, a close), so a
   * composition can tighten its heartbeat while nudges cannot arrive.
   */
  subscribe(
    spaceId: SpaceId,
    handlers: {
      onChange: () => void;
      onDelete: () => void;
      onStatus?: (up: boolean) => void;
    }
  ): () => void;
}

/** One journaled structural command, as the engine replays it. */
export interface JournaledOp {
  id: number;
  spaceId: SpaceId;
  op: string;
  payload: Record<string, unknown>;
  nodeIds: KnowledgeResourceId[];
}

/**
 * The local half: the ledger's cursors and journal, plus the replica writer.
 * Structurally satisfied by `createPgliteGraphSyncLedger` +
 * `createPgliteGraphReplicaWriter` from the persistence package — named as an
 * interface here so this package does not depend on it at runtime.
 */
export interface GraphReplica {
  cursorFor(spaceId: SpaceId, table: GraphSyncTableName): Promise<Date | null>;
  advanceCursor(
    spaceId: SpaceId,
    table: GraphSyncTableName,
    cursor: Date
  ): Promise<void>;
  inventoryDue(
    spaceId: SpaceId,
    table: GraphSyncTableName,
    now?: Date
  ): Promise<boolean>;
  applyInventory(
    spaceId: SpaceId,
    table: GraphSyncTableName,
    serverIds: EntityId[]
  ): Promise<number>;
  applyPullBatch(
    table: GraphSyncTableName,
    rows: RowRecord[]
  ): Promise<Date | null>;
  deleteRows(table: GraphSyncTableName, ids: EntityId[]): Promise<number>;
  rowIdsForNodes(
    table: GraphSyncTableName,
    nodeIds: KnowledgeResourceId[]
  ): Promise<EntityId[]>;
  pendingOps(spaceId: SpaceId, limit?: number): Promise<JournaledOp[]>;
  ackOp(opId: number): Promise<void>;
  rejectOp(opId: number): Promise<KnowledgeResourceId[]>;
  pendingCount(spaceId: SpaceId): Promise<number>;
}

export interface PullOutcome {
  /** Rows upserted into the replica, per table. */
  applied: number;
  /** Rows deleted by an inventory sweep (purged or no longer visible). */
  evicted: number;
  /** Tables whose inventory was swept in this pass. */
  swept: GraphSyncTableName[];
  /**
   * Rows the server sent that were not applied, each reported in the first
   * pass that met it and never again by this engine.
   */
  refused: RefusedServerRow[];
}

export interface PushOutcome {
  /** Ops the server accepted and the journal dropped. */
  accepted: number;
  /**
   * Ops the server refused. Each took its dependent ops with it and its
   * nodes were re-pulled — the pull IS the rollback.
   */
  refused: number;
  /** Nodes re-pulled because an op touching them was refused. */
  reconciled: KnowledgeResourceId[];
  /** True when the drain stopped early because the server was unreachable. */
  stalled: boolean;
}
