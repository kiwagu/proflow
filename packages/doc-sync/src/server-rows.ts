import {
  type BrandedEntityId,
  type DocumentId,
  ENTITY_PREFIXES,
  type EntityKind,
  prefixGatedEntityIdSchema,
  strictEntityIdSchemaFor,
  type WriterId,
} from '@workspace/entity-id';
import type { SyncDocumentHead } from './types.js';

/**
 * Where ids from the server become typed ids: the production transport and
 * the test stand-in both read their rows through these, so what reaches the
 * engine has been checked the same way on either.
 *
 * A document id is a key, so it must be a well-formed id of its kind — the
 * full `<prefix>_<rand16>.<ts10>` contract. A writer is only ever compared
 * with this client's own, to skip its own pushes, so a writer is checked by
 * its `wrt_` head alone: a legacy writer with a non-canonical tail is
 * someone else's push and is taken in. What fails is refused for its own
 * document only, never for the pass it came in.
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

const writerGate = prefixGatedEntityIdSchema<'writer'>(ENTITY_PREFIXES.writer);

/** The writer of a `crdt_updates` row: the client instance that pushed it. */
export function parseWriterId(value: unknown): WriterId {
  const parsed = writerGate.safeParse(value);
  if (!parsed.success)
    throw new MalformedServerRowError('crdt_updates', 'writer', value);
  return parsed.data;
}

/** A head the server sent that was not taken in, and why. */
export interface RefusedHead {
  /** The document id as the server holds it. */
  id: string;
  /** When its head last moved, so the space cursor moves past it too. */
  updatedAt: Date;
  error: MalformedServerRowError;
}

/** The heads of a page that can be taken in, and the ones refused, each on its own. */
export function parseHeadRows(
  raw: readonly {
    id: unknown;
    head_seq: unknown;
    updated_at: string | Date;
  }[]
): { rows: SyncDocumentHead[]; refused: RefusedHead[] } {
  const rows: SyncDocumentHead[] = [];
  const refused: RefusedHead[] = [];
  for (const head of raw) {
    const updatedAt = new Date(head.updated_at);
    try {
      rows.push({
        docId: parseDocumentId(head.id),
        headSeq: Number(head.head_seq),
        updatedAt,
      });
    } catch (error) {
      if (!(error instanceof MalformedServerRowError)) throw error;
      refused.push({ id: String(head.id), updatedAt, error });
    }
  }
  return { rows, refused };
}
