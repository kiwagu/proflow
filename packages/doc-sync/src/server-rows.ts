import {
  type BrandedEntityId,
  type DocumentId,
  type EntityKind,
  strictEntityIdSchemaFor,
  type WriterId,
} from '@workspace/entity-id';

/**
 * Where ids from the server become typed ids: the production transport and
 * the test stand-in both read their rows through these, so what reaches the
 * engine has been checked the same way on either.
 *
 * Each id must be well-formed and of its column's kind — the full
 * `<prefix>_<rand16>.<ts10>` contract, canonical lowercase — or the row is
 * refused, and with it the answer it came in: a pull imports nothing and a
 * space pass pulls nothing, so the watermark and the cursor stay where they
 * were.
 */
export class MalformedServerRowError extends Error {
  constructor(
    readonly table: string,
    readonly column: string,
    readonly value: unknown
  ) {
    super(
      `server row refused: ${table}.${column} ${JSON.stringify(value)} is not a well-formed id of its kind`
    );
    this.name = 'MalformedServerRowError';
  }
}

function parseId<K extends EntityKind>(
  table: string,
  column: string,
  kind: K,
  value: unknown
): BrandedEntityId<K> {
  const parsed = strictEntityIdSchemaFor(kind).safeParse(value);
  if (!parsed.success) throw new MalformedServerRowError(table, column, value);
  return parsed.data;
}

/** The id of a `crdt_documents` row: a document id. */
export function parseDocumentId(value: unknown): DocumentId {
  return parseId('crdt_documents', 'id', 'document', value);
}

/** The writer of a `crdt_updates` row: the client instance that pushed it. */
export function parseWriterId(value: unknown): WriterId {
  return parseId('crdt_updates', 'writer', 'writer', value);
}
