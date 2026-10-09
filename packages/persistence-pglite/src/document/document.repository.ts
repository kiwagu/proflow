import {
  type IDocumentRepository,
  newId,
  type SerializedTree,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import { graphInTransaction } from '../graph/graph.transaction.js';
import { type ContentCache, createContentCache } from './content-cache.js';
import type { DocumentCrdtStore } from './document.crdt-store.js';
import { type DocumentRow, toDocumentMeta } from './document.mapper.js';
import { AWAITING_SYNC } from './document.materialize.js';

const META_COLUMNS =
  'id, title, kind, preview, starred, created_at, updated_at';

export function createPgliteDocumentRepository(
  db: AppDb,
  crdt: DocumentCrdtStore,
  spaceId: string,
  userId: string,
  cache: ContentCache = createContentCache()
): IDocumentRepository {
  // Minted per instance: each tab and each worker is its own writer.
  const writer = newId('writer');
  // A merge from another device rewrote the document: an entry cached
  // before it would reopen the old body, and the next save from that body
  // would revert what the other device wrote.
  crdt.onChanged((event) => {
    if (event.source !== 'remote') return;
    const cached = cache.get(event.id);
    if (!cached) return;
    cache.set(event.id, {
      meta: cached.meta,
      content: { tree: event.tree, markdown: event.markdown },
    });
  });
  return {
    writer,

    invalidate(id) {
      crdt.close(id);
      cache.drop(id);
    },

    async create(input) {
      try {
        const id = input?.id ?? newId('document');
        const nodeId = input?.nodeId ?? newId('knowledgeResource');
        // The document and its place in the file tree are one fact.
        const row = await db.transaction(async (tx) => {
          const { rows } = await tx.query<DocumentRow>(
            `insert into document (id, title, kind)
             values ($1, $2, $3)
             returning ${META_COLUMNS}`,
            [id, input?.title ?? '', input?.kind ?? 'md']
          );
          const created = await graphInTransaction(tx).createNode({
            id: nodeId,
            spaceId,
            createdBy: userId,
            kind: 'text',
            title: input?.title ?? '',
            parentId: input?.parentId ?? null,
            body_ref: { doc_id: id },
          });
          if (created.isErr()) throw new Error(created.error);
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
            awaiting_sync: boolean;
          }
        >(
          `select ${META_COLUMNS.replaceAll(/(^|, )/g, '$1d.')},
                  c.lexical_json, c.markdown as content_markdown,
                  (${AWAITING_SYNC}) as awaiting_sync
           from document d left join document_content c on c.document_id = d.id
           where d.id = $1 and d.deleted_at is null`,
          [id]
        );
        const row = rows[0];
        if (!row) {
          // The graph brought the node and the explorer shows it at once;
          // the document row follows with the materializer. In between, the
          // body is on its way, not missing.
          const { rows: nodes } = await db.query<DocumentRow>(
            `select $1::text as id, r.title, 'md' as kind, '' as preview,
                    false as starred, r.created_at, r.updated_at
             from knowledge_resources r
             where r.kind = 'text' and r.deleted_at is null
               and r.body_ref ->> 'doc_id' = $1
             limit 1`,
            [id]
          );
          const node = nodes[0];
          if (!node) return err(`document ${id} not found`);
          return ok({
            meta: toDocumentMeta(node),
            content: null,
            awaitingSync: true,
          });
        }

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
        return ok({
          meta,
          content,
          awaitingSync: !content && row.awaiting_sync,
        });
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
