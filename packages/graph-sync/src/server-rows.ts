import {
  type EntityId,
  type EntityKind,
  strictEntityIdSchemaFor,
} from '@workspace/entity-id';
import { describeTable, type GraphSyncTableName } from './tables.js';
import type { RowRecord } from './types.js';

/**
 * Where ids from the server become typed ids: every row a transport hands
 * the engine passes through here first, the production adapter and the test
 * stand-in alike.
 *
 * Each id column a table declares must hold a well-formed id of its kind —
 * the full `<prefix>_<rand16>.<ts10>` contract — or the row is refused. A
 * refusal is per row: the rest of its page is applied as usual, so one row
 * the server should never have held cannot stop a table from syncing. The
 * replica's own CHECKs would refuse such a row too, but deep inside a batch,
 * taking the whole page down with it, and with an error that names no column.
 */
export class MalformedServerRowError extends Error {
  constructor(
    readonly table: GraphSyncTableName,
    readonly column: string,
    readonly value: unknown
  ) {
    super(
      `server row refused: ${table}.${column} ${JSON.stringify(value)} is not a well-formed id of its kind`
    );
    this.name = 'MalformedServerRowError';
  }
}

/** One row the server sent that was not applied, and why. */
export interface RefusedServerRow {
  table: GraphSyncTableName;
  /** The row's id as the server holds it — possibly the malformed value itself. */
  id: string;
  /** The row's `updated_at`, so the cursor can move past it like any other. */
  updatedAt: Date | null;
  error: MalformedServerRowError;
}

function parseId(
  table: GraphSyncTableName,
  column: string,
  kind: EntityKind,
  value: unknown
): EntityId {
  const parsed = strictEntityIdSchemaFor(kind).safeParse(value);
  if (!parsed.success) throw new MalformedServerRowError(table, column, value);
  return parsed.data;
}

/**
 * One row as the server sent it, with its id columns checked. Throws
 * `MalformedServerRowError` for a row that cannot be taken in.
 */
export function parseServerRow(
  table: GraphSyncTableName,
  raw: Record<string, unknown>
): RowRecord {
  const row: Record<string, unknown> = { ...raw };
  for (const [column, kind] of Object.entries(describeTable(table).idColumns)) {
    const value = raw[column];
    // `id` and `space_id` are on every row; other id columns may be null.
    if (value == null && column !== 'id' && column !== 'space_id') continue;
    row[column] = parseId(table, column, kind, value);
  }
  return row as RowRecord;
}

function timestampOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return null;
}

/** The rows of a page that can be taken in, and the ones refused, each on its own. */
export function parseServerRows(
  table: GraphSyncTableName,
  raw: readonly Record<string, unknown>[]
): { rows: RowRecord[]; refused: RefusedServerRow[] } {
  const rows: RowRecord[] = [];
  const refused: RefusedServerRow[] = [];
  for (const candidate of raw) {
    try {
      rows.push(parseServerRow(table, candidate));
    } catch (error) {
      if (!(error instanceof MalformedServerRowError)) throw error;
      refused.push({
        table,
        id: String(candidate['id']),
        updatedAt: timestampOf(candidate['updated_at']),
        error,
      });
    }
  }
  return { rows, refused };
}

/**
 * An inventory: the ids of one table that are well-formed ids of its own
 * kind. A malformed one is left out — the replica can never hold it, so the
 * sweep has nothing to keep or evict for it, and the pull is what reports it.
 */
export function parseServerIds(
  table: GraphSyncTableName,
  raw: readonly unknown[]
): EntityId[] {
  const kind = describeTable(table).idColumns['id'];
  if (!kind) throw new Error(`no id kind declared for ${table}`);
  const schema = strictEntityIdSchemaFor(kind);
  const ids: EntityId[] = [];
  for (const value of raw) {
    const parsed = schema.safeParse(value);
    if (parsed.success) ids.push(parsed.data);
  }
  return ids;
}
