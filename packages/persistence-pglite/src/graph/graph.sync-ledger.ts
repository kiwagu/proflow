import type { AppDb } from '../db/db.js';
import { type GraphOpRow, toGraphOp } from './graph.mapper.js';
import type { GraphOp } from './graph.types.js';

/**
 * The local half of graph replication: the per-(space, table) pull cursors and
 * the op journal's drain/reconcile operations. This is the LEDGER only — the
 * transport that talks to the server lives with the sync worker; everything
 * here is what that worker reads and writes locally, so the ledger's rules
 * are testable without a network.
 *
 * The three mechanics it serves, per the replication design:
 *
 *   * pull by watermark — a cursor over the server's `updated_at`, re-read
 *     with a small overlap window so equal timestamps cannot skip rows;
 *   * disappearance by inventory diff — the server's id list under the user's
 *     own visibility, compared against local ids; what is missing locally is
 *     gone (purged, or no longer visible) and is deleted;
 *   * push by idempotent replay — the journal drains in order, at-least-once,
 *     and a refusal drops the op AND every journaled op touching the same
 *     node, because a later op on a node whose earlier op the server refused
 *     is built on a state the server never had.
 */

/** The replicated tables, in the order a checkout pulls them. */
export const GRAPH_SYNC_TABLES = [
  'knowledge_resources',
  'knowledge_edges',
  'resource_user_state',
  'kb_resource_description',
  'kb_resource_link',
  'kb_media_blob',
  'kb_resource_media_meta',
] as const;

export type GraphSyncTable = (typeof GRAPH_SYNC_TABLES)[number];

/**
 * How far back of the watermark each pull re-reads. Two rows written in the
 * same millisecond, one of them after the cursor was taken, would otherwise
 * be invisible forever; re-reading a window costs a few duplicate upserts and
 * removes the whole class of miss.
 */
export const PULL_OVERLAP_MS = 5_000;

/**
 * How often the inventory diff sweeps an open space. Between sweeps a purged
 * or access-revoked row may linger locally; any write it triggers fails on
 * push and evicts it then, so the staleness can only ever show a row the user
 * could see recently — never one they were never allowed to see.
 */
export const INVENTORY_INTERVAL_MS = 5 * 60_000;

export interface GraphSyncLedger {
  /**
   * The watermark to pull from for one table, already backed off by the
   * overlap window; `null` when the table has never been pulled (a checkout —
   * pull everything).
   */
  cursorFor(spaceId: string, table: GraphSyncTable): Promise<Date | null>;
  /** Advance a table's watermark after a pull batch lands. */
  advanceCursor(
    spaceId: string,
    table: GraphSyncTable,
    cursor: Date
  ): Promise<void>;

  /** When the id inventory diff last completed for a table. */
  inventoryAt(spaceId: string, table: GraphSyncTable): Promise<Date | null>;
  /** Whether a table's inventory sweep is due (never run, or older than the interval). */
  inventoryDue(
    spaceId: string,
    table: GraphSyncTable,
    now?: Date
  ): Promise<boolean>;
  /**
   * Apply one inventory: `serverIds` is everything the server shows this user
   * in the space. Local ids absent from it are deleted and their count
   * returned — a purge or an access revocation, indistinguishable locally and
   * handled identically.
   */
  applyInventory(
    spaceId: string,
    table: GraphSyncTable,
    serverIds: string[]
  ): Promise<number>;

  /** The next journaled ops to push, oldest first. */
  pendingOps(spaceId: string, limit?: number): Promise<GraphOp[]>;
  /** Drop an op the server accepted. */
  ackOp(opId: number): Promise<void>;
  /**
   * Reconcile a refusal: drop the refused op and every LATER journaled op in
   * the same space that touches any node it touched, and report those nodes
   * so the caller can re-pull them. Earlier ops are untouched — they were
   * accepted, and the server's rows already reflect them.
   */
  rejectOp(opId: number): Promise<string[]>;
  /** How many ops are still waiting — the "unsynced changes" signal. */
  pendingCount(spaceId: string): Promise<number>;
}

export function createPgliteGraphSyncLedger(db: AppDb): GraphSyncLedger {
  async function inventoryTimestamp(
    spaceId: string,
    table: GraphSyncTable
  ): Promise<Date | null> {
    const { rows } = await db.query<{ inventory_at: Date | null }>(
      `select inventory_at from graph_row_sync
        where space_id = $1 and table_name = $2`,
      [spaceId, table]
    );
    return rows[0]?.inventory_at ?? null;
  }

  return {
    async cursorFor(spaceId, table) {
      const { rows } = await db.query<{ cursor: Date | null }>(
        `select cursor from graph_row_sync
          where space_id = $1 and table_name = $2`,
        [spaceId, table]
      );
      const cursor = rows[0]?.cursor ?? null;
      if (cursor === null) return null;
      return new Date(cursor.getTime() - PULL_OVERLAP_MS);
    },

    async advanceCursor(spaceId, table, cursor) {
      await db.query(
        `insert into graph_row_sync (space_id, table_name, cursor)
         values ($1, $2, $3)
         on conflict (space_id, table_name) do update
           -- Never move a watermark backwards: two pulls can interleave, and
           -- the older one finishing last must not re-open a window the newer
           -- one already closed.
           set cursor = greatest(graph_row_sync.cursor, excluded.cursor),
               updated_at = now()`,
        [spaceId, table, cursor]
      );
    },

    inventoryAt(spaceId, table) {
      return inventoryTimestamp(spaceId, table);
    },

    async inventoryDue(spaceId, table, now = new Date()) {
      const at = await inventoryTimestamp(spaceId, table);
      if (at === null) return true;
      return now.getTime() - at.getTime() >= INVENTORY_INTERVAL_MS;
    },

    async applyInventory(spaceId, table, serverIds) {
      // `= any($2)` takes the id list as ONE array parameter, so an inventory
      // of any size is one statement with one bind — no chunking, and no SQL
      // built by string concatenation.
      const { rows } = await db.query<{ id: string }>(
        `delete from ${table}
          where space_id = $1 and not (id = any ($2::text[]))
          returning id`,
        [spaceId, serverIds]
      );
      await db.query(
        `insert into graph_row_sync (space_id, table_name, inventory_at)
         values ($1, $2, now())
         on conflict (space_id, table_name) do update
           set inventory_at = now(), updated_at = now()`,
        [spaceId, table]
      );
      return rows.length;
    },

    async pendingOps(spaceId, limit = 100) {
      const { rows } = await db.query<GraphOpRow>(
        `select id, space_id, op, payload, node_ids, created_at
           from graph_op_journal
          where space_id = $1
          order by id
          limit $2`,
        [spaceId, limit]
      );
      return rows.map(toGraphOp);
    },

    async ackOp(opId) {
      await db.query('delete from graph_op_journal where id = $1', [opId]);
    },

    async rejectOp(opId) {
      const { rows } = await db.query<{ node_ids: string[] }>(
        `with refused as (
           delete from graph_op_journal where id = $1
           returning space_id, id, node_ids
         ),
         dependent as (
           delete from graph_op_journal j
            using refused
            where j.space_id = refused.space_id
              and j.id > refused.id
              and j.node_ids && refused.node_ids
           returning j.node_ids
         )
         select node_ids from refused
         union all
         select node_ids from dependent`,
        [opId]
      );
      const affected = new Set<string>();
      for (const row of rows) for (const id of row.node_ids) affected.add(id);
      return [...affected];
    },

    async pendingCount(spaceId) {
      const { rows } = await db.query<{ count: number | string }>(
        'select count(*) as count from graph_op_journal where space_id = $1',
        [spaceId]
      );
      return Number(rows[0]?.count ?? 0);
    },
  };
}
