/*
 * document body fence: a document's body (snapshot, update log, named
 * versions, server search rows) is visible and editable to exactly the
 * people who may read and edit the resource that owns it.
 *
 * why
 *   content is private by default and shared deliberately: the resource row
 *   carries a visibility floor and additive grants, and the resource select
 *   policy is the fence. the body tables were fenced on space membership
 *   plus the space.documents.* verbs only, which every active member holds —
 *   so a member could read the bytes of another member's private document
 *   straight through the api, and push bytes into it. the body must follow
 *   the resource.
 *
 * the link
 *   the document names the resource that owns it (crdt_documents.resource_id,
 *   written once by the document's creator when the document is registered;
 *   the table has no update policy, so nobody rewrites it), and the resource
 *   names the document back (knowledge_resources.body_ref->>'doc_id'). the
 *   body counts as the resource's only when BOTH say so and the resource
 *   lives in the document's space. neither side alone is trusted: any member
 *   can create a resource, name someone else as its owner and point it at a
 *   document, and any editor of a shared resource can repoint its body_ref —
 *   but only the creator of a document can say which resource owns it, so a
 *   forged or rewritten pointer opens nothing. ownership of the resource may
 *   move: the body follows the resource, not its first owner.
 *
 * the creator
 *   the graph and the document bodies are pushed by two independent engines,
 *   so a body can reach the server before its resource row. the document's
 *   creator keeps access through crdt_documents.created_by so their own push
 *   never fails on that race. a body whose resource never arrives is visible
 *   to its creator only; removing it is the orphan reaper's job.
 *
 * read vs write
 *   read follows the resource read predicate (owner, floor, cohort and
 *   per-user grants, containment inheritance, supervisory lines). write is
 *   the resource row's own update rule — owner, or the space update verb on
 *   a readable resource. the grant disjuncts are read grants: a document
 *   shared with a person is readable by them, not editable, exactly as the
 *   resource row is. one function, two actions; the read form is never the
 *   write fence.
 *
 * what stays as it is
 *   crdt_documents insert (creator, space create verb) and delete (space
 *   delete verb) keep their policies; the update log is still append-only and
 *   compaction is still the only destructive write, now behind the write
 *   side of the fence.
 *
 * two forms of one predicate
 *   an INSERT ... RETURNING (what the api sends) makes the new row pass the
 *   select policy as well, and a function that fetches the row by id cannot
 *   see a row its own statement is inserting. so the core takes the
 *   document's own columns (the select policy on crdt_documents passes them
 *   straight from the row), and a thin wrapper by id serves the satellite
 *   tables and the compaction rpc, whose document row already exists.
 *
 * security definer
 *   the predicate reads knowledge_resources on behalf of the caller under
 *   another user's rights (the resource may be hidden from them while a grant
 *   still opens it), so it must run as definer, with an empty search path and
 *   every object qualified. it lives in the private schema, outside the api
 *   surface, like the other policy helpers.
 */

-- ---------------------------------------------------------------------------
-- the link: the document names its resource
-- ---------------------------------------------------------------------------

alter table public.crdt_documents
  add column if not exists resource_id text;

comment on column public.crdt_documents.resource_id is
  'The resource that owns this body. Set once by the creator when registering the document; never updated (the table has no update policy). A body counts as the resource''s only when the resource points back through body_ref.';

-- documents registered before the column existed: bind the pairs that already
-- agree. the same creator made both sides, the resource points back, and they
-- share a space; this runs once, as the table owner, over rows no member
-- could have forged against a fence that did not exist yet.
update public.crdt_documents d
set resource_id = r.id
from public.knowledge_resources r
where d.resource_id is null
  and r.body_ref ->> 'doc_id' = d.id
  and r.space_id = d.space_id
  and r.created_by = d.created_by;

-- ---------------------------------------------------------------------------
-- the predicate: the core takes the document's own columns...
-- ---------------------------------------------------------------------------

create or replace function private.auth_user_can_access_document_row(
  p_doc_id text,
  p_space_id text,
  p_created_by uuid,
  p_resource_id text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when p_action not in ('read', 'update') then false
      else
        public.auth_user_can_access_in_space(p_space_id, 'space.documents.' || p_action)
        and (
          p_created_by = (select auth.uid())
          or exists (
            select 1
            from public.knowledge_resources r
            where r.id = p_resource_id
              and r.body_ref ->> 'doc_id' = p_doc_id
              and r.space_id = p_space_id
              and private.auth_user_can_access_resource(
                    r.id, r.space_id, r.owner_user_id, r.visibility,
                    'space.knowledge.read')
              and (
                p_action = 'read'
                or public.auth_user_can_access_in_space(r.space_id, 'space.knowledge.update')
              )
          )
        )
    end;
$$;

comment on function private.auth_user_can_access_document_row(text, text, uuid, text, text) is
  'The body fence on a document row''s own columns, so it also holds for a row being inserted: the creator, or the resource that owns the body (named by the document, pointing back) under the resource''s own read predicate; editing additionally needs the space update verb.';

revoke all on function private.auth_user_can_access_document_row(text, text, uuid, text, text) from public;
revoke all on function private.auth_user_can_access_document_row(text, text, uuid, text, text) from anon;
grant execute on function private.auth_user_can_access_document_row(text, text, uuid, text, text) to authenticated;

-- ...and the wrapper by id, for tables and rpcs whose document row exists

create or replace function private.auth_user_can_access_document(
  p_doc_id text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select private.auth_user_can_access_document_row(d.id, d.space_id, d.created_by, d.resource_id, p_action)
      from public.crdt_documents d
      where d.id = p_doc_id
    ),
    false
  );
$$;

comment on function private.auth_user_can_access_document(text, text) is
  'The body fence by document id: may the caller read (''read'') or edit (''update'') the document''s body? False for an id that names no document.';

revoke all on function private.auth_user_can_access_document(text, text) from public;
revoke all on function private.auth_user_can_access_document(text, text) from anon;
grant execute on function private.auth_user_can_access_document(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- crdt_documents: read through the fence; insert and delete keep their shape
-- ---------------------------------------------------------------------------

drop policy if exists "crdt_documents select for scoped readers" on public.crdt_documents;
drop policy if exists "crdt_documents select through the body fence" on public.crdt_documents;
create policy "crdt_documents select through the body fence"
on public.crdt_documents
for select
to authenticated
using (
  private.auth_user_can_access_document_row(
    crdt_documents.id, crdt_documents.space_id, crdt_documents.created_by,
    crdt_documents.resource_id, 'read')
);

-- ---------------------------------------------------------------------------
-- crdt_updates
-- ---------------------------------------------------------------------------

drop policy if exists "crdt_updates select mirrors document read" on public.crdt_updates;
drop policy if exists "crdt_updates select through the body fence" on public.crdt_updates;
create policy "crdt_updates select through the body fence"
on public.crdt_updates
for select
to authenticated
using (private.auth_user_can_access_document(crdt_updates.doc_id, 'read'));

drop policy if exists "crdt_updates insert mirrors document update" on public.crdt_updates;
drop policy if exists "crdt_updates insert through the body fence" on public.crdt_updates;
create policy "crdt_updates insert through the body fence"
on public.crdt_updates
for insert
to authenticated
with check (
  crdt_updates.created_by = (select auth.uid())
  and private.auth_user_can_access_document(crdt_updates.doc_id, 'update')
);

-- ---------------------------------------------------------------------------
-- crdt_document_versions
-- ---------------------------------------------------------------------------

drop policy if exists "crdt_document_versions select mirrors document read" on public.crdt_document_versions;
drop policy if exists "crdt_document_versions select through the body fence" on public.crdt_document_versions;
create policy "crdt_document_versions select through the body fence"
on public.crdt_document_versions
for select
to authenticated
using (private.auth_user_can_access_document(crdt_document_versions.doc_id, 'read'));

drop policy if exists "crdt_document_versions insert mirrors document update" on public.crdt_document_versions;
drop policy if exists "crdt_document_versions insert through the body fence" on public.crdt_document_versions;
create policy "crdt_document_versions insert through the body fence"
on public.crdt_document_versions
for insert
to authenticated
with check (
  crdt_document_versions.created_by = (select auth.uid())
  and private.auth_user_can_access_document(crdt_document_versions.doc_id, 'update')
);

drop policy if exists "crdt_document_versions update mirrors document update" on public.crdt_document_versions;
drop policy if exists "crdt_document_versions update through the body fence" on public.crdt_document_versions;
create policy "crdt_document_versions update through the body fence"
on public.crdt_document_versions
for update
to authenticated
using (private.auth_user_can_access_document(crdt_document_versions.doc_id, 'update'))
with check (private.auth_user_can_access_document(crdt_document_versions.doc_id, 'update'));

drop policy if exists "crdt_document_versions delete mirrors document update" on public.crdt_document_versions;
drop policy if exists "crdt_document_versions delete through the body fence" on public.crdt_document_versions;
create policy "crdt_document_versions delete through the body fence"
on public.crdt_document_versions
for delete
to authenticated
using (private.auth_user_can_access_document(crdt_document_versions.doc_id, 'update'));

-- ---------------------------------------------------------------------------
-- server search projections: derived text follows the body
-- ---------------------------------------------------------------------------

drop policy if exists "server_document_chunk select mirrors document read" on public.server_document_chunk;
drop policy if exists "server_document_chunk select through the body fence" on public.server_document_chunk;
create policy "server_document_chunk select through the body fence"
on public.server_document_chunk
for select
to authenticated
using (private.auth_user_can_access_document(server_document_chunk.document_id, 'read'));

drop policy if exists "server_document_index_state select mirrors document read" on public.server_document_index_state;
drop policy if exists "server_document_index_state select through the body fence" on public.server_document_index_state;
create policy "server_document_index_state select through the body fence"
on public.server_document_index_state
for select
to authenticated
using (private.auth_user_can_access_document(server_document_index_state.document_id, 'read'));

-- ---------------------------------------------------------------------------
-- compaction: the one destructive write, now behind the write side of the fence
-- ---------------------------------------------------------------------------

create or replace function public.rpc_compact_document(
  p_doc_id text,
  p_snapshot bytea,
  p_covers_seq bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_max_seq bigint;
  v_applied integer;
begin
  if p_snapshot is null or octet_length(p_snapshot) = 0 then
    raise exception 'snapshot must not be empty';
  end if;
  if p_covers_seq is null or p_covers_seq <= 0 then
    raise exception 'covers_seq must be positive';
  end if;

  -- same error for "missing" and "not permitted": no existence oracle.
  if not private.auth_user_can_access_document(p_doc_id, 'update') then
    raise exception 'document not found or not accessible';
  end if;

  -- a caller may only fold updates that exist: a covers_seq beyond the
  -- current tail would hide later-arriving rows behind the watermark.
  select coalesce(max(u.seq), 0) into v_max_seq
  from public.crdt_updates u
  where u.doc_id = p_doc_id;

  if p_covers_seq > v_max_seq then
    return false;
  end if;

  -- concurrent-compaction guard: only advance, never regress. the row lock
  -- taken here serializes racing compactions; the loser sees 0 rows updated
  -- and must not delete anything.
  update public.crdt_documents d
  set snapshot = p_snapshot,
      snapshot_seq = p_covers_seq,
      updated_at = timezone('utc', now())
  where d.id = p_doc_id
    and d.snapshot_seq < p_covers_seq;

  get diagnostics v_applied = row_count;

  if v_applied = 0 then
    return false;
  end if;

  -- writes that landed during the snapshot upload have seq > covers_seq and
  -- survive this delete.
  delete from public.crdt_updates u
  where u.doc_id = p_doc_id
    and u.seq <= p_covers_seq;

  return true;
end;
$$;
