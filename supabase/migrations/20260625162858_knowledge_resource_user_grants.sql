/*
 * knowledge graph — per-user (per-person) grant dimension (see docs/knowledge-graph-plan.md §5).
 *
 * purpose
 * - add the THIRD additive OR'd grant to knowledge-resource visibility: a direct,
 *   named share of one resource to one identified space member. It is a calque of the
 *   cohort grant (knowledge_resource_scopes) — a pure data-driven (resource, user) link
 *   table, its same-space guard, a pure boolean sub-predicate, and ONE new OR line in
 *   the composing helper. People are auth.users, not graph nodes (the same rule that
 *   keeps reporting_lines off knowledge_edges) — topology is untouched, Invariant #1 holds.
 *
 * authorization, not gating
 * - this is L1/ACCESS (RLS): a grant only ever WIDENS the SELECT fence (a private node
 *   shared with one person becomes visible to owner + that person, nobody else). Failing
 *   the predicate HIDES the node (absent from results); it never marks it available=false
 *   and never enters the engine's gating registry. The resolver (security invoker)
 *   applies it natively across every projection and traversal — zero engine change.
 *
 * placement of the new disjunct (deliberate divergence from cohort)
 * - the per-user grant is a TOP-LEVEL OR, OUTSIDE the `base AND (...)` group — mirroring
 *   the intrinsic owner branch. A grant is a direct act of sharing to one identified
 *   person; its authority to SEE rests on the grant row itself (we do not additionally
 *   require the grantee to independently hold space.knowledge.read). This is safe because
 *   a same-space guard pins grantee and resource to ONE space at insert — no cross-space
 *   grant can exist, so the top-level OR cannot leak across spaces.
 *
 * authority to share (owner-sovereign + admin)
 * - creating / revoking a grant is owner-sovereign OR space.knowledge.access, baked
 *   directly into this table's INSERT/DELETE policies (parity with the D9 floor rule).
 *   This is deliberately STRICTER than the cohort link policy, which gates on
 *   space.knowledge.access alone — the owner branch is included so the rule is correct
 *   when roles differentiate. A grantee receives READ visibility only; the
 *   knowledge_resources update/delete USING predicates are untouched (a grantee is a
 *   reader, exactly as a cohort member is).
 *
 * no entity-id prefix is introduced — the link table has a composite (resource_id,
 * user_id) primary key, parity with knowledge_resource_scopes.
 */

-- ---------------------------------------------------------------------------
-- per-user grant link table (calque of knowledge_resource_scopes)
-- ---------------------------------------------------------------------------

create table public.knowledge_resource_user_grants (
  resource_id text not null references public.knowledge_resources (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (resource_id, user_id)
);

comment on table public.knowledge_resource_user_grants is
  'Join table: a knowledge resource shared to ONE specific space member (per-user grant). An additive READ grant — a granted node is visible to that user on top of the floor; never fences. The grantee must be a member of the resource''s space (same-space guard).';

-- hot path: "what is shared WITH me" (the shared-with-me projection).
create index knowledge_resource_user_grants_user_resource_idx
  on public.knowledge_resource_user_grants (user_id, resource_id);

-- same-space guard: the grantee must be an active member of the resource's space.
-- this is load-bearing — it is what makes the top-level-OR placement safe (no
-- cross-space grant can exist, so the disjunct cannot leak across spaces).
create or replace function public.assert_knowledge_resource_user_grant_same_space()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_resource_space_id text;
begin
  select r.space_id into v_resource_space_id
  from public.knowledge_resources r
  where r.id = new.resource_id;

  if v_resource_space_id is null then
    raise exception 'knowledge_resource_user_grants references unknown resource';
  end if;

  if not exists (
    select 1
    from public.space_memberships sm
    where sm.space_id = v_resource_space_id
      and sm.user_id = new.user_id
      and sm.status = 'active'
  ) then
    raise exception 'knowledge_resource_user_grants grantee must be an active member of the resource''s space';
  end if;

  return new;
end;
$$;

create trigger knowledge_resource_user_grants_same_space_guard
before insert or update on public.knowledge_resource_user_grants
for each row
execute function public.assert_knowledge_resource_user_grant_same_space();

-- ---------------------------------------------------------------------------
-- per-user grant predicate (pure, data-driven sub-function; calque of the cohort one)
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_resource_user_grant(
  p_resource_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- POSITIVE per-user GRANT (ADR-0017 §1.5 D3): true iff the resource is shared
  -- directly with the current user. Like the cohort grant it is ADDITIVE — it never
  -- defaults true for an un-granted node; it only ever WIDENS access. Keyed on
  -- resource_id only, so it reads the separate grant table (visible regardless of the
  -- RETURNING row) and stays safe under INSERT/UPDATE ... RETURNING.
  select exists (
    select 1
    from public.knowledge_resource_user_grants g
    where g.resource_id = p_resource_id
      and g.user_id = (select auth.uid())
  );
$$;

comment on function public.knowledge_resource_user_grant(text) is
  'Per-user GRANT dimension (ADR-0017 §1.5 D3): true iff the resource is shared directly with the current user. Additive (OR-composed top-level on the visibility floor); never defaults true for an un-granted node. Pure, data-driven, no DDL per grant.';

revoke all on function public.knowledge_resource_user_grant(text) from public;
grant execute on function public.knowledge_resource_user_grant(text) to authenticated;

-- ---------------------------------------------------------------------------
-- helper rewrite — add EXACTLY ONE top-level OR line (per-user grant)
-- signature and all landed disjuncts are byte-identical otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_can_access_resource(
  p_resource_id text,
  p_space_id text,
  p_owner_user_id uuid,
  p_visibility text,
  p_verb text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Visibility model (ADR-0017 §1.5): ONE broadcast floor (visibility) + additive
  -- OR'd grants. The floor is the single broadcast dial; cohort/per-user grants only
  -- ever WIDEN. is_owner is intrinsic ("you see your own"), hierarchy is the
  -- supervisory branch. Parens are normative (ADR-0008 §1): the base space-membership
  -- check is INSIDE the broadcast/cohort branch so no branch leaks across spaces.
  --
  -- the row's identifying columns (id/space_id/owner_user_id/visibility) are passed
  -- IN by the policy rather than self-fetched: a self-fetch by id cannot see the row
  -- during an INSERT/UPDATE ... RETURNING (the new row is not yet visible to a
  -- sub-query in the same command), which would spuriously deny the RETURNING read.
  -- the only sub-predicates still keyed on id (cohort + per-user grant) read separate
  -- link tables (visible regardless), so they are RETURNING-safe too.
  select
    -- intrinsic ownership: you always see what you own
    p_owner_user_id = (select auth.uid())
    -- base space-membership + (broadcast floor OR additive cohort grant)
    or (
      public.auth_user_can_access_in_space(p_space_id, p_verb)
      and (
        p_visibility in ('space', 'organization')
        or public.knowledge_resource_scope_member(p_resource_id)
      )
    )
    -- additive per-user grant (top-level OR, mirrors is_owner; same-space guard pins
    -- grantee + resource to one space at insert, so this cannot leak across spaces)
    or public.knowledge_resource_user_grant(p_resource_id)
    -- supervisory oversight (checks space membership INSIDE; no cross-space leak)
    or public.auth_user_manages_owner(p_owner_user_id, p_space_id);
$$;

comment on function public.auth_user_can_access_resource(text, text, uuid, text, text) is
  'Composes knowledge-resource hard-access (ADR-0017 §1.5): is_owner OR (base space+verb AND (visibility floor in space/organization OR cohort grant)) OR per-user grant OR manager hierarchy. The single helper every knowledge_resources SELECT policy references; the policy passes the row''s id/space_id/owner_user_id/visibility so it also works under INSERT/UPDATE ... RETURNING.';

revoke all on function public.auth_user_can_access_resource(text, text, uuid, text, text) from public;
grant execute on function public.auth_user_can_access_resource(text, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- rls — the per-user grant link table
-- select under read; insert/delete owner-sovereign OR access (no update).
-- ---------------------------------------------------------------------------

alter table public.knowledge_resource_user_grants enable row level security;

revoke all on public.knowledge_resource_user_grants from public;

-- a grant is add/remove, never mutate — no UPDATE grant.
grant select, insert, delete on public.knowledge_resource_user_grants to authenticated;

-- select under read (keyed on the resource's space): any space reader may see who a
-- node is shared with (parity with the cohort link select policy).
create policy "knowledge_resource_user_grants select for scoped readers"
on public.knowledge_resource_user_grants
for select
to authenticated
using (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_user_grants.resource_id
      and public.auth_user_can_access_in_space(
        r.space_id,
        'space.knowledge.read'
      )
  )
);

-- insert owner-sovereign OR access-manager (D9): the resource owner manages the
-- audience of their own content, or a space access-manager (admin tier). Stricter
-- than the cohort insert policy (which gates on access alone) — the owner branch is
-- baked in directly so the rule is correct when roles differentiate (ADR-0019 §3).
create policy "knowledge_resource_user_grants insert for owner or access managers"
on public.knowledge_resource_user_grants
for insert
to authenticated
with check (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_user_grants.resource_id
      and (
        r.owner_user_id = (select auth.uid())
        or public.auth_user_can_access_in_space(
          r.space_id,
          'space.knowledge.access'
        )
      )
  )
);

-- delete (revoke) symmetric to insert — owner-sovereign OR access-manager.
create policy "knowledge_resource_user_grants delete for owner or access managers"
on public.knowledge_resource_user_grants
for delete
to authenticated
using (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_user_grants.resource_id
      and (
        r.owner_user_id = (select auth.uid())
        or public.auth_user_can_access_in_space(
          r.space_id,
          'space.knowledge.access'
        )
      )
  )
);
