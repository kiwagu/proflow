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
 * the full `<prefix>_<rand16>.<ts10>` contract, canonical lowercase — or the
 * row is refused, and with it everything it arrived with: a pull page is
 * applied in one transaction, so a page with one bad row lands nothing
 * rather than half. The replica's own CHECKs would refuse such a row too,
 * but deep inside a batch and with an error that names no column.
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

/** One row as the server sent it, with its id columns checked and canonical. */
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

export function parseServerRows(
  table: GraphSyncTableName,
  raw: readonly Record<string, unknown>[]
): RowRecord[] {
  return raw.map((row) => parseServerRow(table, row));
}

/** An inventory: the ids of one table, each checked as that table's own kind. */
export function parseServerIds(
  table: GraphSyncTableName,
  raw: readonly unknown[]
): EntityId[] {
  const kind = describeTable(table).idColumns['id'];
  if (!kind) throw new Error(`no id kind declared for ${table}`);
  return raw.map((value) => parseId(table, 'id', kind, value));
}
