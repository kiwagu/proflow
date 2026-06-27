/*
 * purpose:
 *   the "Media is publicly accessible" policy on storage.objects granted SELECT
 *   to ALL roles (anon + authenticated) for the entire media bucket, which lets
 *   any unauthenticated caller LIST every object in the bucket. the supabase
 *   advisor flags this as public_bucket_allows_listing.
 *
 *   the media bucket stays public (bucket.public = true), so per-object reads by
 *   url continue to be served through the storage public-object endpoint, which
 *   does NOT consult this rls policy. the only consumers of the SELECT policy are
 *   the authenticated list/render apis. narrowing the policy to the authenticated
 *   role removes anon enumeration while preserving:
 *     - public object-url access (public endpoint, bucket.public flag), and
 *     - authenticated render/list of media.
 *
 * affected objects: policy "Media is publicly accessible" on storage.objects.
 *
 * special considerations:
 *   - forward-only; recreates the single SELECT policy scoped to authenticated.
 *   - app code reads media via getPublicUrl only; the sole list() caller is a
 *     test using the service role (rls-exempt), so no app path depends on anon
 *     listing.
 */

-- drop the over-broad all-roles SELECT policy that enabled anon bucket listing.
drop policy if exists "Media is publicly accessible" on storage.objects;

-- re-grant media SELECT to authenticated only (no anon enumeration). public
-- object urls keep working via the storage public-object endpoint (bucket.public).
create policy "Media readable by authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'media');
