import { DocumentCrdt } from '@workspace/doc-crdt';
import type { AppDb } from '../db/db.js';

/**
 * A document this device knows only from the graph: the sync ledger says it
 * was never pulled, and no byte of it is held here. Its body is on the
 * server, so an empty page would be a lie — the editor says it is loading.
 * A document created here has no ledger row until its first push, and one
 * pushed or pulled holds bytes, so neither ever matches. `d` is the
 * document row.
 */
export const AWAITING_SYNC = `exists (
    select 1 from document_sync s
    where s.document_id = d.id and s.pulled_seq = 0
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
 * kind) and the sync ledger records it as known and empty: nothing pulled
 * yet, and the empty version as what has been pushed — this device has
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
         select unnest($1::text[]), $2::bytea, 0
         on conflict (document_id) do nothing`,
        [rows.map((r) => r.id), DocumentCrdt.create().versionBytes()]
      );
    }
    return rows.length;
  });
  return added ?? 0;
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
 * Documents with local changes the server may not have: never pushed, or
 * changed since their ledger row was last written. What a catch-up push
 * opens — every other document is in step with what was pushed or pulled,
 * and opening it would only load its CRDT to compare two equal versions.
 */
export async function listUnpushedDocuments(db: AppDb): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select d.id from document d
     left join document_sync s on s.document_id = d.id
     where d.deleted_at is null
       and (s.document_id is null or d.updated_at > s.updated_at)`
  );
  return rows.map((r) => r.id);
}
