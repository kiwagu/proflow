/*
 * kb.media_blob (kmb) + kb.resource_media_meta (kmm) — the shared-blob media
 * substrate (ADR-0026, amended by ADR-0027).
 *
 * The byte layer is NORMALIZED out of the 1:1 satellite: a `kb.media_blob` row
 * owns the byte-intrinsic metadata (blob-addressed storage path, mime, size,
 * checksum, duration) plus an authoritative reference count; the satellite
 * `kb.resource_media_meta` is a thin REFERENCE (node → blob) carrying only the
 * per-reference display filename. Many kmm rows may point at ONE immutable blob —
 * this is what makes a within-space file copy O(1) (new node + new reference,
 * zero byte movement) and byte deletion refcount-gated (bytes are reaped only
 * when the LAST reference disappears).
 *
 * Path convention (blob-addressed, node-agnostic):
 *   spaces/<space_id>/kb/blobs/<kmb_id>/<object_key>
 * storage.foldername() segments: [1]='spaces' [2]=space_id [3]='kb' [4]='blobs'
 * [5]=blob_id (the object_key is the FILENAME, excluded from foldername — this is
 * why the blob id must be a folder segment, not the terminal name).
 *
 * refcount is a CROSS-OWNER fact: RLS hides other owners' references, so it must
 * NEVER be derived by counting kmm under a caller's RLS (an under-count would reap
 * bytes another owner still holds — cross-owner data loss). It is a STORED column
 * whose SINGLE writer is the SECURITY DEFINER trigger below (ADR-0027 §5/§Risks).
 *
 * provenance_author_id is the "zero author" (ADR-0027 §6): a bare uuid, NO foreign
 * key (it must never block or cascade the blob's lifecycle), display/attribution
 * only — NEVER an input to access or reaping.
 *
 * Reuses the shared kb satellite machinery from
 * 20260620190000_kb_application_satellites.sql (kb.set_updated_at,
 * kb.assert_satellite_same_space). RLS on kmm mirrors the parent node's access
 * exactly (read = space.knowledge.read; write = space.knowledge.update).
 *
 * See docs/knowledge-graph-plan.md for the public plan.
 */

-- ===========================================================================
-- kb.media_blob (kmb) — the immutable, reference-counted byte record
-- ===========================================================================
create table kb.media_blob (
  id text primary key default public.entity_id_generate('kmb'),
  space_id text not null references public.spaces (id) on delete cascade,
  storage_bucket text not null default 'kb-media',
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text null,
  duration_ms integer null,
  refcount integer not null default 0,
  provenance_author_id uuid null,
  uploaded_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.media_blob is
  'Immutable, reference-counted KB media byte record (ADR-0027). Blob-addressed path in the private kb-media bucket; N kmm references share one blob. refcount is trigger-owned (SECURITY DEFINER) — never derive it under a caller''s RLS. provenance_author_id is the FK-less "zero author" (display only).';

create index media_blob_space_id_idx on kb.media_blob (space_id);
-- The reconcile reaper scans for refcount-0 blobs (ADR-0027 §7).
create index media_blob_refcount_zero_idx on kb.media_blob (refcount) where refcount = 0;

create trigger media_blob_set_updated_at
before update on kb.media_blob
for each row execute function kb.set_updated_at();

-- ===========================================================================
-- kb.resource_media_meta (kmm) — the per-node REFERENCE to a blob (1:1 by node)
-- ===========================================================================
create table kb.resource_media_meta (
  id text primary key default public.entity_id_generate('kmm'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  -- RESTRICT is the refcount>0 invariant, DB-enforced: a blob row cannot be
  -- dropped while any reference still points at it.
  blob_id text not null references kb.media_blob (id) on delete restrict,
  original_filename text not null,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_media_meta is
  'KB node satellite (1:1): a REFERENCE from a file/video node to a shared kb.media_blob (ADR-0027). Carries only per-reference display metadata (original_filename); byte-intrinsic metadata lives on the blob. Mirrors node access; never a parallel graph.';

create index resource_media_meta_space_id_idx on kb.resource_media_meta (space_id);
-- The storage.objects policies and the refcount recompute both look up references
-- BY BLOB — this index is load-bearing for every byte access check.
create index resource_media_meta_blob_id_idx on kb.resource_media_meta (blob_id);

-- ---------------------------------------------------------------------------
-- triggers: shared kb satellite machinery (functions already exist)
-- ---------------------------------------------------------------------------
create trigger resource_media_meta_set_updated_at
before update on kb.resource_media_meta
for each row execute function kb.set_updated_at();

create trigger resource_media_meta_same_space_guard
before insert or update on kb.resource_media_meta
for each row execute function kb.assert_satellite_same_space();

-- ---------------------------------------------------------------------------
-- integrity belt: a reference may only point at a blob in the SAME space
-- (cross-space sharing is forbidden by decision — across a space boundary a copy
-- MATERIALIZES a new blob, ADR-0027 §5). Data-integrity trigger, not RLS: it is
-- an invariant of the model, independent of who writes.
-- ---------------------------------------------------------------------------
create or replace function kb.assert_media_ref_same_space()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_blob_space_id text;
begin
  select b.space_id into v_blob_space_id
  from kb.media_blob b
  where b.id = new.blob_id;

  if v_blob_space_id is null then
    raise exception 'kmm references unknown blob_id %', new.blob_id;
  end if;

  if v_blob_space_id <> new.space_id then
    raise exception 'kmm must reference a blob in its own space (cross-space blob sharing is forbidden; materialize instead)';
  end if;

  return new;
end;
$$;

comment on function kb.assert_media_ref_same_space() is
  'Guards kmm: the referenced kb.media_blob must live in the same space (ADR-0027 — cross-space copies materialize a new blob, never share one).';

create trigger resource_media_meta_blob_same_space_guard
before insert or update on kb.resource_media_meta
for each row execute function kb.assert_media_ref_same_space();

-- ---------------------------------------------------------------------------
-- refcount maintenance — the SINGLE writer of kb.media_blob.refcount.
--
-- SECURITY DEFINER is load-bearing (ADR-0027 §Risks): the count is a CROSS-OWNER
-- fact. The acting user's RLS cannot see other owners' references, so the
-- bookkeeping must run RLS-blind; the trigger mutates the blob row regardless of
-- who caused the reference change (insert, delete, node-cascade, re-point).
-- ---------------------------------------------------------------------------
create or replace function kb.media_blob_refcount_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update kb.media_blob set refcount = refcount + 1 where id = new.blob_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- The blob row may already be gone (space CASCADE ordering) — 0 rows is fine.
    update kb.media_blob set refcount = refcount - 1 where id = old.blob_id;
    return old;
  end if;

  -- UPDATE: only a re-point moves the count ("new version" = new blob, ADR-0027 §3).
  if new.blob_id <> old.blob_id then
    update kb.media_blob set refcount = refcount - 1 where id = old.blob_id;
    update kb.media_blob set refcount = refcount + 1 where id = new.blob_id;
  end if;
  return new;
end;
$$;

comment on function kb.media_blob_refcount_apply() is
  'SECURITY DEFINER trigger: sole writer of kb.media_blob.refcount (+1/-1 on kmm insert/delete/re-point). RLS-blind by design — the count is a cross-owner fact (ADR-0027).';

-- Trigger-only: firing a trigger never checks the caller's EXECUTE, so no API
-- role needs it (advisor lints 0028/0029 — a SECURITY DEFINER function must not
-- be callable via /rest/v1/rpc).
revoke all on function kb.media_blob_refcount_apply() from public, anon, authenticated;

create trigger resource_media_meta_refcount
after insert or update or delete on kb.resource_media_meta
for each row execute function kb.media_blob_refcount_apply();

-- ---------------------------------------------------------------------------
-- checksum setter — write-once, uploader-only (SECURITY DEFINER because blob
-- UPDATE is deliberately NOT granted to authenticated; the checksum is the one
-- caller-supplied field written after upload, kept cheap for B2 dedup later).
-- ---------------------------------------------------------------------------
create or replace function kb.media_blob_set_checksum(p_blob_id text, p_checksum text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update kb.media_blob
  set checksum = p_checksum
  where id = p_blob_id
    and uploaded_by = (select auth.uid())
    and checksum is null;
end;
$$;

comment on function kb.media_blob_set_checksum(text, text) is
  'Write-once checksum set by the blob''s own uploader (SECURITY DEFINER: blob UPDATE is not granted to authenticated). Best-effort — silently no-op when not the uploader or already set.';

revoke all on function kb.media_blob_set_checksum(text, text) from public, anon;
grant execute on function kb.media_blob_set_checksum(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — kb.media_blob. Reads are reference-fenced; writes are NOT granted to
-- authenticated at all (refcount is trigger-owned; blob-row deletion at
-- refcount 0 is the service_role reconcile reaper's job, ADR-0027 §7).
-- ---------------------------------------------------------------------------
alter table kb.media_blob enable row level security;
revoke all on kb.media_blob from public;
grant select, insert on kb.media_blob to authenticated;
-- service_role bypasses RLS but still needs the privilege for the reconcile reaper.
grant select, insert, update, delete on kb.media_blob to service_role;

-- SELECT: the uploader always sees their own blobs (needed to read back the
-- reservation on authorize + the confirm flow), and anyone holding a READABLE
-- reference sees the blob (the download authorizer resolves kmm → blob under the
-- caller; read composes grants — the ADR-0026 read fence, inherited).
create policy "kb_media_blob select for uploader or readable reference"
on kb.media_blob for select to authenticated
using (
  uploaded_by = (select auth.uid())
  or exists (
    select 1
    from kb.resource_media_meta k
    join public.knowledge_resources r on r.id = k.node_id
    where k.blob_id = media_blob.id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.read')
  )
);

-- INSERT: a self-attributed reservation in a space where the caller holds the
-- knowledge-read verb. Deliberately loose (ADR-0027 §Risks: a byte-less,
-- reference-less row is harmless and reaped) — the REAL fences are the node-update
-- check in the upload authorizer, the kmm policies, and the storage.objects RLS.
create policy "kb_media_blob insert self-attributed in member space"
on kb.media_blob for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and refcount = 0
  and public.auth_user_can_access_in_space(space_id, 'space.knowledge.read')
);

-- ---------------------------------------------------------------------------
-- RLS — kb.resource_media_meta: mirror the parent node's access
-- (read = read; write = update) — unchanged in shape from ADR-0026.
-- ---------------------------------------------------------------------------
alter table kb.resource_media_meta enable row level security;
revoke all on kb.resource_media_meta from public;
grant select, insert, update, delete on kb.resource_media_meta to authenticated;
-- service_role bypasses RLS but still needs the privilege for reconcile jobs.
grant select, insert, update, delete on kb.resource_media_meta to service_role;

create policy "kb_media_meta select mirrors node read"
on kb.resource_media_meta for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.read')
  )
);

create policy "kb_media_meta insert mirrors node update"
on kb.resource_media_meta for insert to authenticated
with check (
  resource_media_meta.created_by = (select auth.uid())
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_media_meta update mirrors node update"
on kb.resource_media_meta for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_media_meta delete mirrors node update"
on kb.resource_media_meta for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);
