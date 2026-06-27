/*
 * co-member identity directory — public.space_member_directory (see docs/knowledge-graph-plan.md §5).
 *
 * purpose
 * - resolve co-member display_name + email for any people-picker (Share dialog today;
 *   @mentions / assignment / platform member-role list tomorrow). The profiles SELECT
 *   policy is own-row-only, so a co-member's name never returns under the caller's RLS;
 *   every other member renders as a bare short-id. this function is the single, named,
 *   auditable widening that resolves co-member identity — the own-row profiles posture
 *   is UNTOUCHED.
 *
 * the fence (load-bearing — zero service-role)
 * - the function is security definer (so it can read other members' profiles rows the
 *   caller's own-row policy hides) but is gated INSIDE the body by
 *   auth_user_active_in_space(p_space_id, auth.uid()) — the SAME predicate the
 *   space_memberships SELECT policy uses. A non-member of p_space_id gets ZERO rows: the
 *   membership conjunct on the caller fails for every directory row. Expressed as a
 *   row-WHERE conjunct so the function stays a pure language-sql set-returning function
 *   (no plpgsql branch) — logically an early-return guard. fail-closed by construction.
 *
 * scale (structural)
 * - search (p_query: case-insensitive substring over display_name OR email) + a hard
 *   server-side limit live in the function. it can NEVER return an unbounded set
 *   (limit least(greatest(coalesce(p_limit, 20), 1), 50)). default 20, floor 1, hard max 50.
 *
 * NOTE on the signature: space ids are text in this schema (public.spaces.id is text), so
 * p_space_id is text — and auth_user_active_in_space takes (text, uuid). (The design note's
 * uuid sketch assumed a uuid space id; the landed schema is text.) user_id is uuid.
 *
 * generic + reusable
 * - the function knows nothing about grants, owners, or sharing. callers (the Share
 *   fanout) subtract owner + already-granted from the bounded result. no app names in the
 *   contract.
 */

create or replace function public.space_member_directory(
  p_space_id text,
  p_query text default null,
  p_limit int default 20
)
returns table (user_id uuid, display_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.display_name, p.email
  from public.space_memberships m
  join public.profiles p on p.user_id = m.user_id
  where m.space_id = p_space_id
    and m.status = 'active'
    -- the fence: the caller must be an active member of the SAME space.
    and public.auth_user_active_in_space(p_space_id, (select auth.uid()))
    and (
      p_query is null
      or btrim(p_query) = ''
      or p.display_name ilike '%' || btrim(p_query) || '%'
      or p.email ilike '%' || btrim(p_query) || '%'
    )
  order by coalesce(nullif(btrim(p.display_name), ''), p.email) asc, p.user_id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.space_member_directory(text, text, int) is
  'Co-member identity directory: returns display_name + email for active members of '
  'p_space_id, gated by the caller''s own active membership (security definer; the '
  'membership conjunct is the fence). Substring search + hard server-side limit (max 50).';

revoke all on function public.space_member_directory(text, text, int) from public;
grant execute on function public.space_member_directory(text, text, int) to authenticated;
