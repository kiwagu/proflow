import type { AppDb } from '../db/db.js';
import type { GraphSyncTable } from './graph.sync-ledger.js';

/**
 * Applying a pull batch to the replica. The server is the sole authority for
 * these rows, so a pulled row overwrites whatever the replica holds — there
 * is no merge here and no per-column comparison: the row that arrives IS the
 * current truth, including for columns a local proposal touched, because a
 * proposal the server accepted is already reflected in what it sends back
 * and one it refused was never truth to begin with.
 *
 * The writes are column-driven from the row's own keys, so a server column
 * added later flows through without a code change here — the replica carries
 * the server's names and shapes deliberately, and this is where that pays.
 * Only known table names and identifier-shaped column names reach the SQL;
 * values always travel as bound parameters.
 */

/** A pulled row: server column names to values, as the transport decodes them. */
export type PulledRow = Record<string, unknown> & { id: string };

const TABLE_NAMES = new Set<string>([
  'knowledge_resources',
  'knowledge_edges',
  'resource_user_state',
  'kb_resource_description',
  'kb_resource_link',
  'kb_media_blob',
  'kb_resource_media_meta',
]);

/** Postgres identifier shape — the only column names allowed into the SQL. */
const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;

export interface GraphReplicaWriter {
  /**
   * Upsert one pull batch. Returns the highest `updated_at` in the batch —
   * the watermark the caller advances the cursor to — or null for an empty
   * batch (nothing moved, so the cursor must not move either).
   */
  applyPullBatch(table: GraphSyncTable, rows: PulledRow[]): Promise<Date | null>;
  /**
   * Delete rows by id — the Realtime DELETE nudge's immediate effect, ahead
   * of the next inventory sweep.
   */
  deleteRows(table: GraphSyncTable, ids: string[]): Promise<number>;
}

export function createPgliteGraphReplicaWriter(db: AppDb): GraphReplicaWriter {
  return {
    async applyPullBatch(table, rows) {
      assertTable(table);
      if (rows.length === 0) return null;
      let watermark: Date | null = null;

      await db.transaction(async (tx) => {
        for (const row of rows) {
          const columns = Object.keys(row).filter((column) => {
            if (!COLUMN_NAME.test(column)) {
              throw new Error(`unsafe column name in pull batch: ${column}`);
            }
            return true;
          });
          const quoted = columns.map((column) => `"${column}"`);
          const placeholders = columns.map((_, i) => `$${i + 1}`);
          const assignments = quoted
            .filter((column) => column !== '"id"')
            .map((column) => `${column} = excluded.${column}`);
          await tx.query(
            `insert into ${table} (${quoted.join(', ')})
             values (${placeholders.join(', ')})
             on conflict (id) do update set ${assignments.join(', ')}`,
            columns.map((column) => row[column])
          );
          const updatedAt = row['updated_at'];
          const at =
            updatedAt instanceof Date
              ? updatedAt
              : typeof updatedAt === 'string'
                ? new Date(updatedAt)
                : null;
          if (at && (watermark === null || at > watermark)) watermark = at;
        }
      });

      return watermark;
    },

    async deleteRows(table, ids) {
      assertTable(table);
      if (ids.length === 0) return 0;
      const { rows } = await db.query<{ id: string }>(
        `delete from ${table} where id = any ($1::text[]) returning id`,
        [ids]
      );
      return rows.length;
    },
  };
}

function assertTable(table: string): void {
  if (!TABLE_NAMES.has(table)) {
    throw new Error(`not a replicated table: ${table}`);
  }
}
