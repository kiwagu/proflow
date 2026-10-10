import { DocumentCrdt } from '@workspace/doc-crdt';
import type { AppDb } from '../db/db.js';

/**
 * The pull watermark of a document this device knows only from the graph
 * and has never asked the server about. Below every real watermark, so the
 * first pull — even one that finds nothing — moves it up for good, and the
 * space feed takes any head of it as due.
 */
const NEVER_PULLED = -1;

/**
 * A document this device knows only from the graph: never asked the server
 * about, and no byte of it held here. Its body may be on the server, so an
 * empty page would be a lie — the editor says it is loading. A document
 * created here is never marked so, even once pushed while still empty;
 * one the server turned out to hold nothing for stops matching after that
 * first pull. `d` is the document row.
 */
export const AWAITING_SYNC = `exists (
    select 1 from document_sync s
    where s.document_id = d.id and s.pulled_seq < 0
  )
  and not exists (select 1 from document_update u where u.document_id = d.id)
  and not exists (select 1 from document_snapshot n where n.document_id = d.id)`;

/**
 * Local document rows for the text nodes the graph brought in.
 *
 * The graph replicates nodes; a node of kind `text` points at its body by
 * document id, and on the device that created it the `document` row was
 * written together with the node. On every other device the node arrives
 * alone, and a document row has to exist before any byte of the body can
 * be journaled against it — the journal and the ledger both reference it.
 *
 * The row is created from the node (same id, the node's title, the default
 * kind) and the sync ledger records it as known and empty: never pulled,
 * and the empty version as what has been pushed — this device has
 * nothing of its own to send, so whatever its first pull brings is not
 * sent back. Nodes in the trash are left alone; restoring one brings it
 * here on the next run. Idempotent: a run that finds nothing to add
 * changes nothing.
 */
export async function materializeDocuments(
  db: AppDb,
  spaceId: string
): Promise<number> {
  const added = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into document (id, title, kind)
       select r.body_ref ->> 'doc_id', r.title, 'md'
       from knowledge_resources r
       where r.space_id = $1
         and r.kind = 'text'
         and r.deleted_at is null
         and r.body_ref ->> 'doc_id' is not null
         and public.is_entity_id_with_prefix(r.body_ref ->> 'doc_id', 'doc')
         and not exists (
           select 1 from document d where d.id = r.body_ref ->> 'doc_id'
         )
       on conflict (id) do nothing
       returning id`,
      [spaceId]
    );
    if (rows.length > 0) {
      await tx.query(
        `insert into document_sync (document_id, pushed_vv, pulled_seq)
         select unnest($1::text[]), $2::bytea, $3
         on conflict (document_id) do nothing`,
        [
          rows.map((r) => r.id),
          DocumentCrdt.create().versionBytes(),
          NEVER_PULLED,
        ]
      );
    }
    return rows.length;
  });
  return added ?? 0;
}

/**
 * The node that owns a document's body, asked for when the body is first
 * registered with the server. The server fences a body through that
 * resource, and takes the name only at that first registration, so it has to
 * be the creator's own and it has to be settled before the body goes.
 *
 * A document created here carries the node it was created with, written in
 * the transaction that made both. A document the graph brought in — the same
 * person's second device — has none, and gets it from what the device holds
 * now: the one node the signed-in user made that points at it. Other
 * people's nodes pointing at the same id are claims anyone can make and are
 * never taken, however early or visible; with none of the user's own, or
 * more than one, nobody is named and the body stays visible to its creator
 * only. It is asked for here and not when the document row is made, because
 * a row can be made before the user's own node has arrived.
 */
export async function resourceIdForDocument(
  db: AppDb,
  documentId: string,
  userId: string
): Promise<string | null> {
  const { rows } = await db.query<{ resource_id: string | null }>(
    `select coalesce(
              d.resource_id,
              (select case when count(*) = 1 then min(m.id) end
               from knowledge_resources m
               where m.body_ref ->> 'doc_id' = d.id and m.created_by = $2)
            ) as resource_id
     from document d where d.id = $1`,
    [documentId, userId]
  );
  return rows[0]?.resource_id ?? null;
}

/** Documents still waiting for their first pull: what a sync start pulls by name. */
export async function listAwaitingDocuments(db: AppDb): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select d.id from document d
     where d.deleted_at is null
       and not exists (select 1 from document_content c where c.document_id = d.id)
       and ${AWAITING_SYNC}`
  );
  return rows.map((r) => r.id);
}

/**
 * Documents with changes the server may not have: never pushed, or whose
 * version as of the last local write is not the version last pushed. What
 * a catch-up push opens — every other document is in step with what was
 * pushed or pulled, and opening it would only load its CRDT to compare two
 * equal versions. Versions, not times: a fold journaled by a pull is a
 * change of this device's even though the pull wrote the ledger after it.
 * A document holding bytes but no recorded version (written before versions
 * were kept) is a candidate until it is opened, which records its version.
 */
export async function listUnpushedDocuments(db: AppDb): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select d.id from document d
     left join document_sync s on s.document_id = d.id
     where d.deleted_at is null
       and (
         s.document_id is null
         or (d.version_vv is not null and d.version_vv is distinct from s.pushed_vv)
         or (
           d.version_vv is null
           and (exists (select 1 from document_update u where u.document_id = d.id)
             or exists (select 1 from document_snapshot n where n.document_id = d.id))
         )
       )`
  );
  return rows.map((r) => r.id);
}
