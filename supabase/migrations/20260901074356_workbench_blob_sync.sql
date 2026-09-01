/*
 * workbench blob sync: the durable server-side copy of the workbench's
 * content-addressed file bytes.
 *
 * model
 *   the client keeps a local content-addressed blob store (bytes keyed by their
 *   sha-256) which is the working set the UI reads. the durable copy lives in
 *   an S3-compatible private bucket, under the SAME content hash — there is no
 *   second identity to reconcile:
 *
 *     spaces/<space_id>/blobs/<sha256>
 *
 *   objects are IMMUTABLE: changed content is a different hash, so an object is
 *   written once and never overwritten. that makes every transfer step
 *   idempotent by construction and removes the conflict story entirely
 *   (concurrent pushes of the same content collide into one object; concurrent
 *   pushes of different content are different keys).
 *
 * why a metadata row at all
 *   bytes in a bucket carry no access fence and no cheap inventory. the
 *   `workbench_blobs` row is both: it is what RLS fences, what a client diffs to
 *   decide whether it must upload, and — because it is written AFTER the bytes
 *   land — the certificate that an object is complete. a row's existence means
 *   "these bytes are fully there"; a row's absence means "assume nothing".
 *   that ordering is the whole durability argument, and it is why the reaper
 *   below deletes the row BEFORE the object (a crash in between leaves
 *   unreferenced bytes, which a sweep collects — never a row promising bytes
 *   that are gone).
 *
 * access model (rls, fail-closed)
 *   a new `space.files.*` permission namespace, seeded onto the system space
 *   roles alongside the document verbs. deliberately only two verbs reach
 *   clients:
 *     - read   — see the metadata row and download the bytes (short-lived
 *                signed urls; the bucket is private and never listable).
 *     - create — insert the metadata row and write a not-yet-certified object.
 *   there is NO client delete, by design: a client's replica may be behind, so
 *   it cannot know whether another member still references a blob. deletion is
 *   the background reaper's job, from the authoritative row set, under the
 *   service role. there is likewise no UPDATE on the metadata row: content
 *   addressing means a row is either right or about different bytes.
 *
 * pre-certificate window
 *   large uploads are resumable, so the transport may touch an object row
 *   several times before the upload finalizes. object UPDATE is therefore
 *   allowed ONLY while no metadata row exists for that (space, hash) — the
 *   window between "bytes are moving" and "bytes are certified". once the row
 *   exists the object is frozen for every client, which is exactly the
 *   immutability guarantee the content address already implies.
 */

-- ---------------------------------------------------------------------------
-- space.files.* permissions and role mapping
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description)
values
  ('space.files.read',   'Read synced file bytes and their metadata in one space.'),
  ('space.files.create', 'Upload file bytes and register their metadata in one space.')
on conflict (key) do nothing;

with mapping(role_key, permission_key) as (
  values
    ('admin',  'space.files.read'),
    ('admin',  'space.files.create'),
    ('author', 'space.files.read'),
    ('author', 'space.files.create'),
    ('member', 'space.files.read'),
    ('member', 'space.files.create')
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
-- storage bucket (private; the prefix is structure, the rls below is the fence)
-- ---------------------------------------------------------------------------

-- file_size_limit is the storage-level backstop only (5 GiB), not the product
-- limit; per-org soft limits live in runtime_settings and are enforced before a
-- client is ever handed an upload target. allowed_mime_types stays null on
-- purpose: the bucket allow-list is positive-only, and the workbench accepts
-- arbitrary user files, so type policy belongs to the application layer.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workbench-blobs', 'workbench-blobs', false, 5368709120, null)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- workbench_blobs (space-scoped metadata mirror of the local blob row)
-- ---------------------------------------------------------------------------

create table public.workbench_blobs (
  space_id text not null references public.spaces (id) on delete cascade,
  -- lowercase hex sha-256 of the content; minted client-side at store time and
  -- the join key across every layer (local row, object key, this row).
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  size bigint not null check (size >= 0),
  mime text not null,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (space_id, hash)
);

comment on table public.workbench_blobs is
  'Metadata mirror of a content-addressed file blob whose bytes live in the private workbench-blobs bucket. The row is written after the bytes land and is therefore the certificate that the object is complete.';

comment on column public.workbench_blobs.hash is
  'Lowercase hex sha-256 of the content; identical to the local store key and to the object key filename.';

-- the reaper sweeps oldest-first within a space and skips anything inside the
-- in-flight grace window, so (space_id, created_at) is its access path.
create index workbench_blobs_space_id_created_at_idx
  on public.workbench_blobs (space_id, created_at);

alter table public.workbench_blobs enable row level security;

create policy "workbench_blobs select for scoped readers"
on public.workbench_blobs
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    workbench_blobs.space_id,
    'space.files.read'
  )
);

create policy "workbench_blobs insert for scoped uploaders"
on public.workbench_blobs
for insert
to authenticated
with check (
  workbench_blobs.created_by = (select auth.uid())
  and public.auth_user_can_access_in_space(
    workbench_blobs.space_id,
    'space.files.create'
  )
);

-- no update policy: the row describes immutable content-addressed bytes, so
-- there is nothing about it a client could legitimately change.
-- no delete policy: a client cannot see other members' references reliably (its
-- replica may lag), so reaping is the background job's decision, not a client's.

-- ---------------------------------------------------------------------------
-- storage.objects rls for workbench-blobs
--
-- path: spaces/<space_id>/blobs/<sha256>
-- storage.foldername(name) yields the directory segments only, so
-- [1]='spaces' [2]=space_id [3]='blobs'; the filename (the hash) is excluded,
-- which is why the read policy matches the row by space alone and leans on the
-- certificate row plus the space fence rather than parsing the leaf.
-- ---------------------------------------------------------------------------

-- SELECT authorizes signed-url issuance and download. It requires the
-- certificate row: bytes with no row are either mid-upload or orphaned, and
-- neither is something a reader should be handed.
create policy "workbench_blobs objects select via certified row"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workbench-blobs'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'blobs'
  and exists (
    select 1
    from public.workbench_blobs b
    where b.space_id = (storage.foldername(name))[2]
      and b.hash = storage.filename(name)
      and public.auth_user_can_access_in_space(b.space_id, 'space.files.read')
  )
);

-- INSERT cannot require the row — the row is written after the bytes, so the
-- space fence plus the path shape IS the check here. Immutability is enforced
-- by the client sending x-upsert:false and by the UPDATE policy below closing
-- the moment a row appears.
create policy "workbench_blobs objects insert for scoped uploaders"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workbench-blobs'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'blobs'
  and storage.filename(name) ~ '^[0-9a-f]{64}$'
  and public.auth_user_can_access_in_space(
        (storage.foldername(name))[2],
        'space.files.create'
      )
);

-- UPDATE covers the resumable-transport window ONLY: allowed while the object
-- is not yet certified by a metadata row, denied forever after.
create policy "workbench_blobs objects update before certification"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'workbench-blobs'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'blobs'
  and public.auth_user_can_access_in_space(
        (storage.foldername(name))[2],
        'space.files.create'
      )
  and not exists (
    select 1
    from public.workbench_blobs b
    where b.space_id = (storage.foldername(name))[2]
      and b.hash = storage.filename(name)
  )
)
with check (
  bucket_id = 'workbench-blobs'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'blobs'
  and storage.filename(name) ~ '^[0-9a-f]{64}$'
  and public.auth_user_can_access_in_space(
        (storage.foldername(name))[2],
        'space.files.create'
      )
  and not exists (
    select 1
    from public.workbench_blobs b
    where b.space_id = (storage.foldername(name))[2]
      and b.hash = storage.filename(name)
  )
);

-- DELETE: no policy for authenticated at all. Aborting an own upload is a
-- transport-level concern of the not-yet-certified object and is handled by the
-- reaper's stray sweep rather than by granting clients byte deletion — a grant
-- that could not be scoped to "only my own in-flight upload" without trusting a
-- claim the server cannot verify.

-- ---------------------------------------------------------------------------
-- anon lockdown: the app is auth-only behind the gateway; rls already returns
-- zero rows to anon (no anon policies), so this only drops the unused
-- table-level grants schema defaults would otherwise leave behind.
-- ---------------------------------------------------------------------------

revoke all on table public.workbench_blobs from anon;
