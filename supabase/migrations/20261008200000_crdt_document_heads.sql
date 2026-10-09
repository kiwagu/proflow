/*
 * crdt document heads: a per-document gap-free update sequence and the
 * columns a space-wide change feed reads.
 *
 * purpose
 *   a client that keeps every document of a space current needs one cheap
 *   question per pass — "which documents changed since my last look, and how
 *   far does each one's log go now?" — not one tail query per document.
 *   crdt_documents gains `head_seq`, the seq of the newest update row, and
 *   `updated_at` now moves on every update row, so the question is one
 *   query over the existing (space_id, updated_at) index.
 *
 * gap-free seq
 *   `seq` was a table-global identity. two writers committing at the same
 *   time can commit out of seq order, so a reader that pulled through
 *   seq = N could miss a row below N that committed later — and would never
 *   ask for it again. from here on `seq` is assigned per document by a
 *   before-insert trigger that increments the document's head_seq. the
 *   update takes the document row's lock, so concurrent inserts into one
 *   document serialize on it: seq order equals commit order, and a reader
 *   holding everything through N provably holds every row at or below N.
 *
 *   the trigger function is security definer with an empty search path:
 *   the update it runs on crdt_documents must bypass rls because
 *   `authenticated` deliberately holds no update policy there (compaction
 *   through the rpc stays the only client mutation). the function does this
 *   one thing and reads nothing from the caller but the row being inserted;
 *   as a trigger function it cannot be called directly through the api.
 *
 * compaction is unchanged: it folds rows at or below covers_seq and still
 * refuses a watermark beyond the current tail. head_seq never regresses, so
 * after a compaction the next row continues the count.
 *
 * realtime
 *   the publication gains crdt_documents, knowledge_resources and
 *   knowledge_edges so the sync engines' change subscriptions carry a
 *   nudge instead of staying silent. replica identity stays default on
 *   purpose: subscribers never read the payload, and a full identity would
 *   copy snapshot bytes into the wal on every change. consequence: a delete
 *   event carries only the key, so a subscription filtered by space_id does
 *   not see deletes — the graph engine's periodic inventory sweep covers
 *   those, as it did before.
 */

-- ---------------------------------------------------------------------------
-- head_seq: the newest update row's seq, per document
-- ---------------------------------------------------------------------------

alter table public.crdt_documents
  add column head_seq bigint not null default 0;

comment on column public.crdt_documents.head_seq is
  'seq of the newest update row of this document. Assigned by the insert trigger on crdt_updates; never regresses; survives compaction.';

-- backfill from the log as it stands; a document without rows stays at 0.
-- existing seq values keep their table-global numbering: only their order
-- per document matters to a reader, and the next row continues above them.
update public.crdt_documents d
set head_seq = coalesce(
  (select max(u.seq) from public.crdt_updates u where u.doc_id = d.id),
  0
);

-- ---------------------------------------------------------------------------
-- seq is assigned per document from now on (see header); the table-global
-- identity goes away. the column stays not null — the trigger fills it.
-- dropping the identity drops its sequence; no existing row or value changes.
-- the default only says to clients that they do not supply seq: the trigger
-- overwrites whatever arrives, the default and any client value alike.
-- ---------------------------------------------------------------------------

alter table public.crdt_updates alter column seq drop identity;
alter table public.crdt_updates alter column seq set default 0;

create or replace function public.crdt_updates_assign_seq()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.crdt_documents d
  set head_seq = d.head_seq + 1,
      updated_at = timezone('utc', now())
  where d.id = new.doc_id
  returning d.head_seq into new.seq;

  -- no document row: refuse with the code the foreign key raised before this
  -- trigger ran ahead of it, rather than invent a seq.
  if new.seq is null then
    raise exception 'crdt document % not found', new.doc_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

-- a trigger fires regardless of the inserting role's execute privilege, so
-- no role needs it: nothing may call the function outside the trigger.
revoke execute on function public.crdt_updates_assign_seq() from public, anon, authenticated;

create trigger crdt_updates_assign_seq
before insert on public.crdt_updates
for each row
execute function public.crdt_updates_assign_seq();

-- ---------------------------------------------------------------------------
-- realtime nudges for both sync engines
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.crdt_documents;
alter publication supabase_realtime add table public.knowledge_resources;
alter publication supabase_realtime add table public.knowledge_edges;
