import type { IDocumentListReader, SerializedTree } from '@workspace/domain';
import type { AppDb } from '../db/db.js';
import { watchQuery } from '../live/watch.js';
import { type DocumentRow, toDocumentMeta } from './document.mapper.js';

type ContentPing = {
  document_id: string;
  writer: string | null;
  updated_at: string;
};

export function createPgliteDocumentListReader(db: AppDb): IDocumentListReader {
  // ONE live query notices every document's saves; per-document
  // subscribers hang off it. Watching is what every open editor does on
  // every switch, and a live query costs a transaction to set up and
  // another to tear down — per switch, on the shared connection, that was
  // most of the wait. The ping carries no content: the tree is fetched
  // only when a foreign write actually hits a watched document.
  const watchers = new Map<
    string,
    Set<(content: { tree: SerializedTree; writer: string | null }) => void>
  >();
  const lastSeen = new Map<string, string>();
  // Whether the feed has delivered once. What is already stored when the
  // feed opens is the baseline; everything after it is news — INCLUDING a
  // document whose content row did not exist yet. A document is written
  // for the first time when someone saves it, and for a second tab
  // watching an unsaved document that first save is the only news there
  // will ever be.
  let primed = false;
  let detach: (() => void) | undefined;

  async function deliver(ping: ContentPing): Promise<void> {
    const callbacks = watchers.get(ping.document_id);
    if (!callbacks || callbacks.size === 0) return;
    const { rows } = await db.query<{ lexical_json: unknown }>(
      'select lexical_json from document_content where document_id = $1',
      [ping.document_id]
    );
    const raw = rows[0]?.lexical_json;
    if (raw == null) return;
    const tree = (
      typeof raw === 'string' ? JSON.parse(raw) : raw
    ) as SerializedTree;
    for (const cb of callbacks) cb({ tree, writer: ping.writer });
  }

  function ensureFeed(): void {
    if (detach) return;
    detach = watchQuery<ContentPing>(
      db,
      `select document_id, writer, updated_at::text as updated_at
       from document_content`,
      [],
      (rows) => {
        for (const ping of rows) {
          const seen = lastSeen.get(ping.document_id);
          lastSeen.set(ping.document_id, ping.updated_at);
          // An unchanged row is not news; a row that is new to a primed
          // feed is a document someone has just saved for the first time.
          if (primed && seen !== ping.updated_at) void deliver(ping);
        }
        primed = true;
      }
    );
  }

  return {
    watchContent(documentId, cb) {
      ensureFeed();
      let set = watchers.get(documentId);
      if (!set) {
        set = new Set();
        watchers.set(documentId, set);
      }
      set.add(cb);
      return () => set.delete(cb);
    },

    watchRecent(cb) {
      // A document exists as long as its node in the tree does: the explorer
      // lists nodes, and trashing one must take the document out of every
      // other list too, or a phantom stays readable through this port alone.
      return watchQuery<DocumentRow>(
        db,
        `select d.id, d.title, d.kind, d.preview, d.starred, d.created_at, d.updated_at
         from document d
         where d.deleted_at is null
           and exists (
             select 1 from knowledge_resources r
             where r.body_ref ->> 'doc_id' = d.id and r.deleted_at is null
           )
         order by d.updated_at desc
         limit 200`,
        [],
        (rows) => cb(rows.map(toDocumentMeta))
      );
    },
  };
}
