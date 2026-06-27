/*
 * purpose:
 *   close the supabase advisor `public_bucket_allows_listing` on the public
 *   `media` bucket. migration 20260627191300 narrowed the bucket's SELECT policy
 *   from all-roles to `authenticated`, which removed anon enumeration but the
 *   advisor still flags it: a PUBLIC bucket needs NO storage.objects SELECT policy
 *   for object access, so any remaining SELECT policy only enables listing.
 *
 *   the media bucket stays public (bucket.public = true). per-object reads by url
 *   keep working through the storage public-object endpoint, which does NOT consult
 *   rls. the only consumer of an authenticated SELECT policy was the list/render
 *   api, and the sole list() caller in this repo is a service-role test (rls-exempt,
 *   see 20260627191300's note). dropping the policy therefore removes authenticated
 *   bucket enumeration with ZERO app impact and clears the advisor.
 *
 * affected objects: policy "Media readable by authenticated" on storage.objects.
 *
 * special considerations:
 *   - forward-only; removes the last broad SELECT policy on the public bucket.
 *   - public object-url access is unaffected (public endpoint + bucket.public flag).
 *   - if an authenticated list/select of media is ever needed, add a NARROW,
 *     ownership- or membership-scoped SELECT policy at that time — never an
 *     all-objects `bucket_id = 'media'` predicate.
 */

-- drop the remaining authenticated-wide SELECT policy. a public bucket serves
-- object urls without rls; keeping a `bucket_id = 'media'` SELECT policy only
-- grants list/enumeration, which the advisor flags and no app path needs.
drop policy if exists "Media readable by authenticated" on storage.objects;
