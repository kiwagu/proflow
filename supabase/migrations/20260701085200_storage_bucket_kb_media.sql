/*
 * kb-media — the PRIVATE Storage bucket for KB file/video bytes (ADR-0026).
 *
 * Unlike the legacy public `media` bucket (whose SELECT policy is a bare
 * bucket_id check, so any object is world-readable by path), this bucket is
 * PRIVATE and its storage.objects RLS mirrors the owning knowledge_resources
 * node's access exactly — read = space.knowledge.read; write =
 * space.knowledge.update. Bytes egress ONLY via short-lived server-authorized
 * signed URLs (Phase 1); the path is not a secret and is never the fence — the
 * RLS below is.
 *
 * Path convention (segments read via storage.foldername):
 *   spaces/<space_id>/kb/<node_id>/<object_key>
 *   [1]='spaces'  [2]=space_id  [3]='kb'  [4]=node_id
 *
 * Every policy delegates to private.auth_user_can_access_resource (owner ⊕
 * base+floor/cohort ⊕ per-user grant ⊕ hierarchy ⊕ inherited containment grant),
 * resolving the node by path segment [4] and pinning its space to segment [2].
 * The r.space_id = segment[2] conjunct is the cross-space isolation belt and MUST
 * appear in every policy. A malformed path (missing/short segments, no matching
 * node) fails CLOSED — the exists() naturally denies.
 *
 * See docs/knowledge-graph-plan.md for the public plan.
 */

-- ---------------------------------------------------------------------------
-- The bucket. PRIVATE (public=false is load-bearing — never true).
-- file_size_limit mirrors supabase/config.toml [storage] 50MiB = 52428800 bytes.
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
values ('kb-media', 'kb-media', false, 52428800, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- storage.objects RLS: mirror the owning node's access via the path segments.
-- ---------------------------------------------------------------------------
create policy "kb_media select mirrors node read"
on storage.objects for select to authenticated
using (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = (storage.foldername(name))[4]
      and r.space_id = (storage.foldername(name))[2]
      and private.auth_user_can_access_resource(
            r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.read')
  )
);

create policy "kb_media insert mirrors node update"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = (storage.foldername(name))[4]
      and r.space_id = (storage.foldername(name))[2]
      and private.auth_user_can_access_resource(
            r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_media update mirrors node update"
on storage.objects for update to authenticated
using (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = (storage.foldername(name))[4]
      and r.space_id = (storage.foldername(name))[2]
      and private.auth_user_can_access_resource(
            r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
)
with check (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = (storage.foldername(name))[4]
      and r.space_id = (storage.foldername(name))[2]
      and private.auth_user_can_access_resource(
            r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_media delete mirrors node update"
on storage.objects for delete to authenticated
using (
  bucket_id = 'kb-media'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'kb'
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = (storage.foldername(name))[4]
      and r.space_id = (storage.foldername(name))[2]
      and private.auth_user_can_access_resource(
            r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);
