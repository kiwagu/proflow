/*
 * co-member identity directory v2 — public.space_member_directory (see docs/knowledge-graph-plan.md §5).
 *
 * what changed from v1 (additive, reset-mode rewrite-in-place of the same function)
 * - keyset pagination: a `(p_after_key text, p_after_user uuid)` cursor resumes the
 *   stable total order AFTER the last seen row — a row-comparison seek, drift-free under
 *   concurrent membership change (offset would re-scan + shift). The two cursor components
 *   are decoded by the caller from an opaque base64url(json{k,u}) token (the DB contract
 *   stays the two plain columns; the encode/decode lives in the fanout, testable). A
 *   null/blank cursor = first page. The query is NOT part of the cursor: a new query is
 *   page 1 (the client debounce handles that).
 * - exclusion BEFORE the limit + BEFORE the count: `p_exclude uuid[]` removes ids
 *   (owner + already-granted, computed by the caller) so the bounded page is full of REAL
 *   grantable candidates and the count is over grantable matches only. Generic — the
 *   function still knows nothing about grants/owners; the caller computes the set.
 * - remaining-count: a windowed `count(*) over()` returns `total_count` — the count of
 *   MATCHING, NON-EXCLUDED candidates for `p_query` (pre-limit, pre-cursor, post-exclude,
 *   post-fence) — in the SAME query (one round-trip, snapshot-consistent), so the picker
 *   can show "+N more". COUNT is bounded by space membership ∩ the substring query (a
 *   modest set), not a scale risk.
 *
 * the fence (load-bearing — zero service-role) — UNCHANGED from v1
 * - security definer (so it reads other members' profiles rows the caller's own-row
 *   policy hides) but gated INSIDE the body by auth_user_active_in_space(p_space_id,
 *   auth.uid()) — the SAME predicate the space_memberships SELECT policy uses. A
 *   non-member of p_space_id gets ZERO rows AND total_count 0: the membership conjunct on
 *   the caller fails for every directory row. fail-closed by construction. The cursor +
 *   count are display conveniences, NEVER fences — a stale page can only mis-display.
 *
 * the order — UNCHANGED from v1: coalesce(nullif(btrim(display_name),''), email) asc,
 * user_id asc. user_id is the unique tiebreaker, so the tuple is a strict total order and
 * the keyset seek is exact.
 *
 * NOTE on the signature: space ids are text in this schema (public.spaces.id is text), so
 * p_space_id is text — and auth_user_active_in_space takes (text, uuid). user_id is uuid.
 *
 * reset-mode: v1's 3-arg overload is dropped (its sole caller is the Share fanout, rewired
 * here). The new signature is the only directory contract.
 */

-- Drop the v1 3-arg overload (reset-mode: the new signature replaces it; a plain
-- create-or-replace cannot change the argument list / return columns).
drop function if exists public.space_member_directory(text, text, int);

create or replace function public.space_member_directory(
  p_space_id text,
  p_query text default null,
  p_limit int default 20,
  p_after_key text default null,
  p_after_user uuid default null,
  p_exclude uuid[] default '{}'::uuid[]
)
returns table (
  user_id uuid,
  display_name text,
  email text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  -- candidates: active co-members of p_space_id matching the substring query, with the
  -- caller's own active membership as the fence, owner/granted already excluded. The
  -- windowed count is evaluated over THIS post-WHERE / pre-LIMIT / pre-cursor set, so it
  -- is the total of grantable matches for the query.
  with candidates as (
    select
      p.user_id,
      p.display_name,
      p.email,
      coalesce(nullif(btrim(p.display_name), ''), p.email) as sort_key,
      count(*) over () as total_count
    from public.space_memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.space_id = p_space_id
      and m.status = 'active'
      -- the fence: the caller must be an active member of the SAME space.
      and public.auth_user_active_in_space(p_space_id, (select auth.uid()))
      -- exclusion BEFORE the limit and BEFORE the count (owner + already-granted).
      and p.user_id <> all (coalesce(p_exclude, '{}'::uuid[]))
      and (
        p_query is null
        or btrim(p_query) = ''
        or p.display_name ilike '%' || btrim(p_query) || '%'
        or p.email ilike '%' || btrim(p_query) || '%'
      )
  )
  select c.user_id, c.display_name, c.email, c.total_count
  from candidates c
  -- keyset seek: resume the stable order strictly AFTER the cursor tuple. user_id is the
  -- unique tiebreaker so the row-comparison is exact (no overlap, no gap).
  where (
    p_after_key is null
    or (c.sort_key, c.user_id) > (p_after_key, p_after_user)
  )
  order by c.sort_key asc, c.user_id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.space_member_directory(text, text, int, text, uuid, uuid[]) is
  'Co-member identity directory v2: returns display_name + email + total_count for active '
  'members of p_space_id, gated by the caller''s own active membership (security definer; '
  'the membership conjunct is the fence). Substring search; p_exclude removes ids before '
  'the limit+count; keyset cursor (p_after_key,p_after_user) pages the stable order; '
  'count(*) over() reports total grantable matches. Hard server-side limit (max 50).';

revoke all on function public.space_member_directory(text, text, int, text, uuid, uuid[]) from public;
grant execute on function public.space_member_directory(text, text, int, text, uuid, uuid[]) to authenticated;
