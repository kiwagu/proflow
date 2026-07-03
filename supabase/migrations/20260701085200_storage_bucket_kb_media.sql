/*
 * kb-media — the PRIVATE Storage bucket for KB file/video bytes (ADR-0026,
 * fence rewritten by ADR-0027 to blob-addressed, REFERENCE-fenced policies).
 *
 * The bucket is PRIVATE and bytes egress ONLY via short-lived server-authorized
 * signed URLs; the path is not a secret and never the fence — the RLS below is.
 *
 * Path convention (blob-addressed, node-agnostic — ADR-0027 §2a):
 *   spaces/<space_id>/kb/blobs/<blob_id>/<object_key>
 * storage.foldername(name) segments: [1]='spaces' [2]=space_id [3]='kb'
 * [4]='blobs' [5]=blob_id (the object_key filename is excluded by foldername).
 *
 * The object is no longer resolved via a node id in the path (fatal for sharing —
 * one blob now serves N nodes). Instead every policy resolves it via the
 * REFERENCE table: "there EXISTS a kb.resource_media_meta row the caller can
 * read/write that references this blob". The `space_id = segment[2]` conjunct is
 * the cross-space isolation belt and MUST appear in every policy; a malformed
 * path fails CLOSED (the exists() naturally denies).
 *
 * READ vs WRITE stay asymmetric (the ADR-0026 amendment holds):
 *   - SELECT (download) composes grants: ANY reference whose node the caller can
 *     READ (owner ⊕ base+floor/cohort ⊕ per-user grant ⊕ hierarchy ⊕ inherited)
 *     authorizes the shared bytes.
 *   - Writes mirror node-UPDATE (owner OR space.knowledge.update) via a
 *     still-present reference — grants are a READ dimension and are NOT composed
 *     for writes (a read-grantee downloads but never overwrites/reaps).
 *   - The FRESH-UPLOAD disjunct (blob exists, uploaded_by = caller) authorizes
 *     the pre-confirm window ONLY: it is gated on `refcount = 0`. Without that
 *     gate the original uploader would keep byte-write (incl. DELETE) on a blob
 *     other owners now share — the exact cross-owner data-loss class ADR-0027
 *     §Risks calls out. Once ANY reference exists, only reference-writers touch
 *     the bytes; and since a "new version" is a NEW blob (immutability), a write
 *     to a referenced blob is never legitimate.
 *
 * The synchronous purge reap MUST run while the caller's kmm still exists (the
 * DELETE policy authorizes via that reference — the ADR-0026 RLS-ordering
 * lesson); true refcount-0 residuals are the service_role reconcile reaper's job.
 *
 * See docs/knowledge-graph-plan.md for the public plan.
 */

-- ---------------------------------------------------------------------------
-- The bucket. PRIVATE (public=false is load-bearing — never true).
-- file_size_limit is the HARD per-object system cap = 5 GiB (5368709120 bytes).
-- This is code/infra config, NOT the soft limit — per-org soft limits live in
-- runtime_settings (platform.media.max_upload_bytes, default 200 MB) and are the
-- authorizer's fence; this bucket cap is only the storage-level backstop.
--
-- allowed_mime_types = null is a DELIBERATE, owner-approved decision:
-- "any-except-dangerous". Supabase bucket allowed_mime_types is a POSITIVE
-- allow-list only (there is no denylist mechanism at the bucket level), so it
-- MUST stay null here; the dangerous-type DENYLIST is enforced server-side in the
-- Phase 1 upload authorizer. Do NOT "fix" this to a restrictive allow-list — that
-- would silently reject legitimate file kinds and is the wrong layer for a
-- denylist.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kb-media', 'kb-media', false, 5368709120, null)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- storage.objects RLS: blob-addressed, reference-fenced (ADR-0027 §4).
-- ---------------------------------------------------------------------------
create policy "kb_media select via readable reference"
on storage.objects for select to authenticated
using (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and (storage.foldername(name))[4] = 'blobs'
  and exists (
    select 1
    from kb.resource_media_meta k
    join public.knowledge_resources r on r.id = k.node_id
    where k.blob_id = (storage.foldername(name))[5]
      and k.space_id = (storage.foldername(name))[2]
      and private.auth_user_can_access_resource(
            r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.read')
  )
);

-- INSERT: ONLY the fresh-upload window — the caller's own byte-less reservation
-- (uploaded_by = caller, refcount = 0). A referenced blob is immutable; writing
-- to it is never legitimate (a new version = a NEW blob), so no writer-replace
-- disjunct exists on purpose.
create policy "kb_media insert fresh upload to own reservation"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and (storage.foldername(name))[4] = 'blobs'
  and exists (
    select 1
    from kb.media_blob b
    where b.id = (storage.foldername(name))[5]
      and b.space_id = (storage.foldername(name))[2]
      and b.uploaded_by = (select auth.uid())
      and b.refcount = 0
  )
);

-- UPDATE: same fresh-upload window (the resumable/TUS transport may touch the
-- object row across chunks/finalization). A referenced blob is never updated.
create policy "kb_media update fresh upload to own reservation"
on storage.objects for update to authenticated
using (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and (storage.foldername(name))[4] = 'blobs'
  and exists (
    select 1
    from kb.media_blob b
    where b.id = (storage.foldername(name))[5]
      and b.space_id = (storage.foldername(name))[2]
      and b.uploaded_by = (select auth.uid())
      and b.refcount = 0
  )
)
with check (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and (storage.foldername(name))[4] = 'blobs'
  and exists (
    select 1
    from kb.media_blob b
    where b.id = (storage.foldername(name))[5]
      and b.space_id = (storage.foldername(name))[2]
      and b.uploaded_by = (select auth.uid())
      and b.refcount = 0
  )
);

-- DELETE: two windows —
--  (1) the uploader aborting/rolling back their own UNREFERENCED upload
--      (cancel/abort terminates the TUS session and deletes the partial), and
--  (2) a node-WRITER holding a still-present reference (the synchronous last-ref
--      purge reap; grants NOT composed — read-grantees never reap).
create policy "kb_media delete by uploader pre-ref or writer via reference"
on storage.objects for delete to authenticated
using (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and (storage.foldername(name))[4] = 'blobs'
  and (
    exists (
      select 1
      from kb.media_blob b
      where b.id = (storage.foldername(name))[5]
        and b.space_id = (storage.foldername(name))[2]
        and b.uploaded_by = (select auth.uid())
        and b.refcount = 0
    )
    or exists (
      select 1
      from kb.resource_media_meta k
      join public.knowledge_resources r on r.id = k.node_id
      where k.blob_id = (storage.foldername(name))[5]
        and k.space_id = (storage.foldername(name))[2]
        and (
          r.owner_user_id = (select auth.uid())
          or public.auth_user_can_access_in_space(r.space_id, 'space.knowledge.update')
        )
    )
  )
);
