import {
  createPgliteGraphReader,
  createPgliteGraphReplicaWriter,
  createPgliteGraphRepository,
  createPgliteGraphSyncLedger,
} from '@workspace/persistence-pglite';
import { openTestDb } from '@workspace/persistence-pglite/testing/graph';
import { createGraphSync, type GraphSyncOptions } from '../graph-sync.js';
import type { GraphReplica, GraphRowTransport } from '../types.js';

/**
 * A client replica: its own real PGlite carrying the app's own migrations,
 * the real ledger/journal/repository over it, and the real engine on top.
 * Nothing here is a double — a "restart" really throws the engine away and
 * rebuilds it against the same database, which is the only way the journal's
 * durability across a tab close can actually be tested.
 */

export interface Replica {
  readonly name: string;
  sync: ReturnType<typeof createGraphSync>;
  repo: ReturnType<typeof createPgliteGraphRepository>;
  reader: ReturnType<typeof createPgliteGraphReader>;
  replica: GraphReplica;
  /** Rows currently held locally in one table. */
  rows<T = Record<string, unknown>>(
    table: string,
    where?: string,
    params?: unknown[]
  ): Promise<T[]>;
  /**
   * Append an op to the journal WITHOUT going through the repository — the
   * only way to reproduce a command composed on another device: it never
   * passed this client's guards, which is precisely the case the server's
   * own guards exist for.
   */
  journalRaw(
    spaceId: string,
    op: string,
    payload: Record<string, unknown>,
    nodeIds: string[]
  ): Promise<void>;
  /** Rebuilds the engine from the same local database — a tab close and reopen. */
  restart(): void;
  close(): Promise<void>;
}

export async function createReplica(
  name: string,
  userId: string,
  transport: GraphRowTransport,
  options: Partial<GraphSyncOptions> = {}
): Promise<Replica> {
  const db = await openTestDb();

  const local = db as unknown as Parameters<
    typeof createPgliteGraphSyncLedger
  >[0];
  const ledger = createPgliteGraphSyncLedger(local);
  const writer = createPgliteGraphReplicaWriter(local);
  const replica: GraphReplica = {
    cursorFor: (space, table) => ledger.cursorFor(space, table),
    advanceCursor: (space, table, cursor) =>
      ledger.advanceCursor(space, table, cursor),
    inventoryDue: (space, table, now) => ledger.inventoryDue(space, table, now),
    applyInventory: (space, table, ids) =>
      ledger.applyInventory(space, table, ids),
    applyPullBatch: (table, rows) => writer.applyPullBatch(table, rows),
    deleteRows: (table, ids) => writer.deleteRows(table, ids),
    rowIdsForNodes: (table, nodeIds) => writer.rowIdsForNodes(table, nodeIds),
    pendingOps: (space, limit) => ledger.pendingOps(space, limit),
    ackOp: (opId) => ledger.ackOp(opId),
    rejectOp: (opId) => ledger.rejectOp(opId),
    pendingCount: (space) => ledger.pendingCount(space),
  };

  const build = () =>
    createGraphSync({
      transport,
      replica,
      identity: { userId },
      ...options,
    });

  const handle: Replica = {
    name,
    sync: build(),
    repo: createPgliteGraphRepository(local),
    reader: createPgliteGraphReader(local),
    replica,
    async rows<T>(table: string, where?: string, params?: unknown[]) {
      // No ORDER BY: not every table has an `id` (the sync ledger keys on
      // space+table). Callers that care about order sort in the assertion.
      const { rows } = await db.query<T>(
        `select * from ${table}${where ? ` where ${where}` : ''}`,
        params
      );
      return rows;
    },
    async journalRaw(spaceId, op, payload, nodeIds) {
      await db.query(
        `insert into graph_op_journal (space_id, op, payload, node_ids)
         values ($1, $2, $3::jsonb, $4)`,
        [spaceId, op, JSON.stringify(payload), nodeIds]
      );
    },
    restart() {
      handle.sync = build();
    },
    close: () => db.close(),
  };
  return handle;
}
