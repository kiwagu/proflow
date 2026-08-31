/*
 * crdt document sync: server-side storage for collaborative documents.
 *
 * purpose
 *   a document is canonically a CRDT (loro). each client edits its own local
 *   replica; the server stores the durable per-space copy that outlives
 *   devices and is what a fresh client checks out. the server treats CRDT
 *   bytes as opaque: it appends updates, stores snapshots, orders rows, and
 *   enforces access — it never opens, merges, or interprets document content.
 *
 * schema
 *   - crdt_documents: one row per document — the latest full snapshot plus
 *     `snapshot_seq`, the watermark up to which updates are folded in.
 *   - crdt_updates:   append-only update log. `seq` is a server-assigned,
 *     table-global identity used purely as a gap-free delivery watermark
 *     (a client that pulled through seq = N and later asks for seq > N in
 *     order provably misses nothing); causality lives inside the CRDT bytes,
 *     so only the relative order per doc_id matters. duplicate delivery is
 *     harmless: importing an operation the document already holds is a no-op,
 *     so the transport is at-least-once with no dedup machinery.
 *   - crdt_document_versions: named versions — a label over a frontier
 *     (a point in CRDT history), ~50 bytes of metadata about the document,
 *     not part of it. they sync as ordinary rows, last-write-wins by id.
 *
 * access model (rls, fail-closed)
 *   - new `space.documents.*` permission namespace, seeded onto the system
 *     space roles: admin gets all verbs; author and member get
 *     read/create/update (documents in a space are collaborative — pushing an
 *     update to a shared document IS editing it, so `update` is the push
 *     verb); delete stays admin-only.
 *   - crdt_documents is the space-scoped anchor; crdt_updates and
 *     crdt_document_versions are satellites whose policies mirror the parent
 *     document row (same pattern as the kb satellites).
 *   - deliberately absent policies (the fence, not an omission):
 *       * no UPDATE policy on crdt_documents — the only legitimate mutation
 *         of a document row is compaction, which must go through the guarded
 *         rpc below; direct PostgREST updates could corrupt snapshot_seq.
 *       * no UPDATE/DELETE policy on crdt_updates — the log is append-only;
 *         rows are removed only by compaction inside the rpc. a plain delete
 *         grant would let any writer destroy other clients' updates without
 *         a covering snapshot (permanent data loss).
 *
 * compaction (rpc_compact_document)
 *   folds updates into the snapshot and deletes the covered rows — the one
 *   destructive operation in the design, so it is the one operation behind an
 *   rpc. the caller (any client that has just pushed and holds everything
 *   through its own row's seq) uploads a FULL snapshot and the seq it covers.
 *   guards:
 *     - explicit space permission check (security definer, so the check is
 *       in the function body; rls policies above deliberately provide no
 *       direct path to these writes).
 *     - `snapshot_seq < covers_seq` makes concurrent compactions safe: the
 *       later-covering one wins, the other is a no-op (returns false).
 *     - `covers_seq` must not exceed the doc's current max seq — a caller
 *       cannot pre-fold updates that do not exist yet (a too-high watermark
 *       would make later rows invisible to pullers).
 *     - only rows with seq <= covers_seq are deleted: writes that land while
 *       a snapshot uploads get a higher seq and survive.
 *   snapshots are always FULL exports (never shallow): the server copy is
 *   what named versions time-travel through and what a fresh checkout
 *   replays, so history must survive compaction.
 */

-- ---------------------------------------------------------------------------
-- space.documents.* permissions and role mapping
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description)
values
  ('space.documents.read',   'Read synced documents (snapshots, updates, named versions) in one space.'),
  ('space.documents.create', 'Create synced documents in one space.'),
  ('space.documents.update', 'Edit synced documents in one space: push updates, compact, manage named versions.'),
  ('space.documents.delete', 'Delete synced documents in one space.')
on conflict (key) do nothing;

with mapping(role_key, permission_key) as (
  values
    ('admin',  'space.documents.read'),
    ('admin',  'space.documents.create'),
    ('admin',  'space.documents.update'),
    ('admin',  'space.documents.delete'),
    ('author', 'space.documents.read'),
    ('author', 'space.documents.create'),
    ('author', 'space.documents.update'),
    ('member', 'space.documents.read'),
    ('member', 'space.documents.create'),
    ('member', 'space.documents.update')
)
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from mapping m
join public.roles r
  on r.key = m.role_key
 and r.role_kind = 'system'
 and r.owner_organization_id is null
 and r.archived_at is null
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;

-- ---------------------------------------------------------------------------
-- crdt_documents (space-scoped anchor)
-- ---------------------------------------------------------------------------

create table public.crdt_documents (
  -- same entity id as the client's local document row; clients mint and
  -- supply it, the default only covers server-side creation paths.
  id text primary key default public.entity_id_generate('doc'),
  space_id text not null references public.spaces (id) on delete cascade,
  -- full loro snapshot; null until the first compaction folds the log.
  snapshot bytea,
  -- updates with seq <= snapshot_seq are folded into the snapshot.
  snapshot_seq bigint not null default 0,
  -- stored byte encoding; lets a future re-encode be a migration, not archaeology.
  format text not null default 'loro-snapshot-v1',
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.crdt_documents is
  'Durable per-space server copy of a collaborative document: latest full CRDT snapshot plus the folded-in watermark. Content bytes are opaque to the server.';

create index crdt_documents_space_id_updated_at_idx
  on public.crdt_documents (space_id, updated_at desc);

alter table public.crdt_documents enable row level security;

create or replace function public.set_crdt_documents_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger crdt_documents_set_updated_at
before update on public.crdt_documents
for each row
execute function public.set_crdt_documents_updated_at();

create policy "crdt_documents select for scoped readers"
on public.crdt_documents
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    crdt_documents.space_id,
    'space.documents.read'
  )
);

create policy "crdt_documents insert for scoped creators"
on public.crdt_documents
for insert
to authenticated
with check (
  crdt_documents.created_by = (select auth.uid())
  and public.auth_user_can_access_in_space(
    crdt_documents.space_id,
    'space.documents.create'
  )
);

-- no update policy on purpose: compaction via rpc_compact_document is the
-- only legitimate mutation (see header).

create policy "crdt_documents delete for scoped deleters"
on public.crdt_documents
for delete
to authenticated
using (
  public.auth_user_can_access_in_space(
    crdt_documents.space_id,
    'space.documents.delete'
  )
);

-- ---------------------------------------------------------------------------
-- crdt_updates (append-only log; satellite of crdt_documents)
-- ---------------------------------------------------------------------------

create table public.crdt_updates (
  doc_id text not null references public.crdt_documents (id) on delete cascade,
  -- table-global monotonic identity; per-doc relative order is the watermark.
  seq bigint generated always as identity,
  bytes bytea not null,
  -- client instance id (each tab / agent worker mints its own) used ONLY for
  -- echo suppression on pull; author identity travels inside the CRDT bytes.
  writer text not null,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (doc_id, seq)
);

comment on table public.crdt_updates is
  'Append-only CRDT update log per document. seq is a gap-free delivery watermark, not a causality mechanism; rows are removed only by compaction.';

alter table public.crdt_updates enable row level security;

create policy "crdt_updates select mirrors document read"
on public.crdt_updates
for select
to authenticated
using (
  exists (
    select 1
    from public.crdt_documents d
    where d.id = crdt_updates.doc_id
      and public.auth_user_can_access_in_space(d.space_id, 'space.documents.read')
  )
);

create policy "crdt_updates insert mirrors document update"
on public.crdt_updates
for insert
to authenticated
with check (
  crdt_updates.created_by = (select auth.uid())
  and exists (
    select 1
    from public.crdt_documents d
    where d.id = crdt_updates.doc_id
      and public.auth_user_can_access_in_space(d.space_id, 'space.documents.update')
  )
);

-- no update/delete policies on purpose: the log is append-only and rows are
-- removed only by compaction inside rpc_compact_document (see header).

-- ---------------------------------------------------------------------------
-- crdt_document_versions (named versions; satellite of crdt_documents)
-- ---------------------------------------------------------------------------

create table public.crdt_document_versions (
  -- same entity id as the client's local version row (clients mint and supply
  -- it); the default only covers server-side creation paths.
  id text primary key default public.entity_id_generate('ver'),
  doc_id text not null references public.crdt_documents (id) on delete cascade,
  label text,
  kind text not null check (kind in ('manual', 'idle', 'pre-ai-edit')),
  -- a frontier: a point in the document's history the version names.
  frontiers jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.crdt_document_versions is
  'Named versions of a synced document: a label over a CRDT frontier. Metadata about the document, synced as ordinary rows (last-write-wins by id).';

create index crdt_document_versions_doc_id_created_at_idx
  on public.crdt_document_versions (doc_id, created_at desc);

alter table public.crdt_document_versions enable row level security;

create or replace function public.set_crdt_document_versions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger crdt_document_versions_set_updated_at
before update on public.crdt_document_versions
for each row
execute function public.set_crdt_document_versions_updated_at();

create policy "crdt_document_versions select mirrors document read"
on public.crdt_document_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.crdt_documents d
    where d.id = crdt_document_versions.doc_id
      and public.auth_user_can_access_in_space(d.space_id, 'space.documents.read')
  )
);

create policy "crdt_document_versions insert mirrors document update"
on public.crdt_document_versions
for insert
to authenticated
with check (
  crdt_document_versions.created_by = (select auth.uid())
  and exists (
    select 1
    from public.crdt_documents d
    where d.id = crdt_document_versions.doc_id
      and public.auth_user_can_access_in_space(d.space_id, 'space.documents.update')
  )
);

create policy "crdt_document_versions update mirrors document update"
on public.crdt_document_versions
for update
to authenticated
using (
  exists (
    select 1
    from public.crdt_documents d
    where d.id = crdt_document_versions.doc_id
      and public.auth_user_can_access_in_space(d.space_id, 'space.documents.update')
  )
)
with check (
  exists (
    select 1
    from public.crdt_documents d
    where d.id = crdt_document_versions.doc_id
      and public.auth_user_can_access_in_space(d.space_id, 'space.documents.update')
  )
);

create policy "crdt_document_versions delete mirrors document update"
on public.crdt_document_versions
for delete
to authenticated
using (
  exists (
    select 1
    from public.crdt_documents d
    where d.id = crdt_document_versions.doc_id
      and public.auth_user_can_access_in_space(d.space_id, 'space.documents.update')
  )
);

-- ---------------------------------------------------------------------------
-- compaction rpc
-- ---------------------------------------------------------------------------

-- security definer rationale: the destructive writes (document update + log
-- delete) intentionally have NO rls path for authenticated, so the fence
-- around direct PostgREST access stays closed; authorization is re-checked
-- explicitly in the body against the caller's own identity and space
-- permission before anything is touched.
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
  v_space_id text;
  v_max_seq bigint;
  v_applied integer;
begin
  if p_snapshot is null or octet_length(p_snapshot) = 0 then
    raise exception 'snapshot must not be empty';
  end if;
  if p_covers_seq is null or p_covers_seq <= 0 then
    raise exception 'covers_seq must be positive';
  end if;

  select d.space_id into v_space_id
  from public.crdt_documents d
  where d.id = p_doc_id;

  -- same error for "missing" and "not permitted": no existence oracle.
  if v_space_id is null
     or not public.auth_user_can_access_in_space(v_space_id, 'space.documents.update')
  then
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

comment on function public.rpc_compact_document(text, bytea, bigint) is
  'Folds a document''s update log into a caller-supplied full snapshot and deletes the covered rows. Returns true when the snapshot was applied, false when a concurrent compaction already covered more or covers_seq exceeds the current tail.';

revoke all on function public.rpc_compact_document(text, bytea, bigint) from public;
revoke all on function public.rpc_compact_document(text, bytea, bigint) from anon;
grant execute on function public.rpc_compact_document(text, bytea, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- anon lockdown: the app is auth-only behind the gateway. rls already returns
-- zero rows to anon (no anon policies), so this only removes the unused
-- table-level grants the schema-default privileges would otherwise leave.
-- ---------------------------------------------------------------------------

revoke all on table public.crdt_documents from anon;
revoke all on table public.crdt_updates from anon;
revoke all on table public.crdt_document_versions from anon;
