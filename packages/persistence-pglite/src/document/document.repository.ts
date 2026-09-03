import {
  type IDocumentRepository,
  newId,
  type SerializedTree,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import { type ContentCache, createContentCache } from './content-cache.js';
import type { DocumentCrdtStore } from './document.crdt-store.js';
import { type DocumentRow, toDocumentMeta } from './document.mapper.js';

const META_COLUMNS =
  'id, title, kind, preview, starred, created_at, updated_at';

export function createPgliteDocumentRepository(
  db: AppDb,
  crdt: DocumentCrdtStore,
  cache: ContentCache = createContentCache()
): IDocumentRepository {
  // Minted per instance: each tab and each worker is its own writer.
  const writer = newId('writer');
  return {
    writer,

    invalidate(id) {
      crdt.close(id);
      cache.drop(id);
    },

    async create(input) {
      try {
        const id = input?.id ?? newId('document');
        const nodeId = input?.nodeId ?? newId('fileNode');
        // The document and its place in the file tree are one fact.
        const row = await db.transaction(async (tx) => {
          const { rows } = await tx.query<DocumentRow>(
            `insert into document (id, title, kind)
             values ($1, $2, $3)
             returning ${META_COLUMNS}`,
            [id, input?.title ?? '', input?.kind ?? 'md']
          );
          await tx.query(
            `insert into file_node (id, parent_id, kind, name, document_id)
             values ($1, $2, 'document', $3, $4)`,
            [nodeId, input?.parentId ?? null, input?.title ?? '', id]
          );
          return rows[0];
        });
        if (!row) return err('insert returned no row');
        return ok(toDocumentMeta(row));
      } catch (e) {
        return err(`document.create failed: ${String(e)}`);
      }
    },

    async load(id) {
      try {
        // A document this client has already seen opens with no query at
        // all: switching between recent documents must not wait in the
        // connection's queue.
        const hit = cache.get(id);
        if (hit) return ok(hit);
        // One round-trip serves the common case: the derived cache holds
        // the same tree every save writes beside the CRDT, and opening a
        // document must not wait in the connection's queue three times.
        // The CRDT — canonical, and needed only to write or to time-travel
        // — opens lazily when those paths run.
        const { rows } = await db.query<
          DocumentRow & {
            lexical_json: unknown;
            content_markdown: string | null;
          }
        >(
          `select ${META_COLUMNS.replaceAll(/(^|, )/g, '$1d.')},
                  c.lexical_json, c.markdown as content_markdown
           from document d left join document_content c on c.document_id = d.id
           where d.id = $1 and d.deleted_at is null`,
          [id]
        );
        const row = rows[0];
        if (!row) return err(`document ${id} not found`);

        let tree =
          row.lexical_json == null
            ? null
            : typeof row.lexical_json === 'string'
              ? (JSON.parse(row.lexical_json) as SerializedTree)
              : (row.lexical_json as SerializedTree);
        // The cache is derived and may legitimately be missing — deleted,
        // or never written; the CRDT is the document then.
        if (!tree) tree = await crdt.load(id);
        const meta = toDocumentMeta(row);
        const content = tree
          ? { tree, markdown: row.content_markdown ?? '' }
          : null;
        if (content) cache.set(id, { meta, content });
        return ok({ meta, content });
      } catch (e) {
        return err(`document.load failed: ${String(e)}`);
      }
    },

    async save(input) {
      try {
        const changed = await crdt.save({ ...input, writer });
        // The save's own payload is the freshest content there is.
        const cached = cache.get(input.id);
        if (cached) {
          cache.set(input.id, {
            meta: cached.meta,
            content: { tree: input.tree, markdown: input.markdown },
          });
        }
        return ok(changed);
      } catch (e) {
        return err(`document.save failed: ${String(e)}`);
      }
    },

    async rename(id, title) {
      try {
        cache.drop(id);
        await db.query(
          'update document set title = $2, updated_at = now() where id = $1',
          [id, title]
        );
        return ok(undefined);
      } catch (e) {
        return err(`document.rename failed: ${String(e)}`);
      }
    },

    async softDelete(id) {
      try {
        cache.drop(id);
        await db.query('update document set deleted_at = now() where id = $1', [
          id,
        ]);
        return ok(undefined);
      } catch (e) {
        return err(`document.softDelete failed: ${String(e)}`);
      }
    },
  };
}
