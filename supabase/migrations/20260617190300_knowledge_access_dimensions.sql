/*
 * knowledge graph — composable HARD-ACCESS dimensions (see docs/knowledge-graph-plan.md §5).
 *
 * purpose
 * - generalize the knowledge-graph hard access layer (RLS) into composable predicate
 *   dimensions over node visibility: (a) cohort membership via the existing `scopes`
 *   primitive, and (b) manager → subordinate hierarchy (supervisory visibility of
 *   resources owned by transitive subordinates). Each dimension is a pure boolean
 *   predicate (resource, user) → bool, driven entirely by data rows.
 *
 * authorization, not gating (the carrying boundary)
 * - both dimensions are L1/ACCESS (RLS): failing a required dimension HIDES the node
 *   (it is absent from results), it does NOT mark it `available=false`. That display
 *   gating layer (slice-05/06) is separate and untouched: these dimensions never
 *   enter the engine's gating-rule registry.
 * - access stays inferred from RLS, never stored in a ProjectionSpec. The resolver
 *   (security invoker) applies these predicates natively across every projection,
 *   traversal and overlay — zero resolver/engine changes.
 *
 * invariants enforced here
 * - cohort: an unrestricted node (no scope link) stays visible (gate defaults true);
 *   a restricted node is visible iff the user is a member of >= 1 of its scopes.
 * - hierarchy: a manager sees resources owned by transitive subordinates, within the
 *   SAME space only — the space membership check lives INSIDE the predicate so the
 *   OR branch cannot leak across spaces.
 * - composition formula (ADR-0017 §1.5, parens normative): is_owner OR (base_access AND (visibility floor OR cohort grant)) OR hierarchy.
 * - same-space guard on the cohort link table (calque of content_item_scopes).
 * - entity-id prefix: rpl (reporting_lines) — registered in the architecture state list.
 *
 * permissions
 * - registers space.knowledge.access (manage knowledge access rules) mapped onto admin
 *   only (author does NOT get it — audience management is an admin-level concern,
 *   parity with space.content.access).
 *
 * note: only SELECT/visibility is generalized. insert/update/delete policies on
 * knowledge_resources and all knowledge_edges policies are untouched (authoring
 * rights stay as today). visibility-column, time-bound and assignment-based access
 * are deliberately deferred — a future dimension is one sub-function + one helper line.
 */

-- ---------------------------------------------------------------------------
-- permission verb + role mapping (access manager — admin only)
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description) values
  ('space.knowledge.access', 'Manage knowledge access rules (cohorts, reporting lines) in one space.')
on conflict (key) do nothing;

with mapping(role_key, permission_key) as (
  values
    ('admin', 'space.knowledge.access')
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
-- dimension 1 — cohort: knowledge_resource_scopes (calque of content_item_scopes)
-- ---------------------------------------------------------------------------

create table public.knowledge_resource_scopes (
  resource_id text not null references public.knowledge_resources (id) on delete cascade,
  scope_id text not null references public.scopes (id) on delete cascade,
  linked_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (resource_id, scope_id)
);

comment on table public.knowledge_resource_scopes is
  'Join table: knowledge resources linked to scopes (cohorts) inside one space. A linked node is visible only to scope members (members-only-read).';

create index knowledge_resource_scopes_scope_resource_idx
  on public.knowledge_resource_scopes (scope_id, resource_id);

create or replace function public.assert_knowledge_resource_scope_same_space()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_resource_space_id text;
  v_scope_space_id text;
begin
  select r.space_id into v_resource_space_id
  from public.knowledge_resources r
  where r.id = new.resource_id;

  select s.space_id into v_scope_space_id
  from public.scopes s
  where s.id = new.scope_id;

  if v_resource_space_id is null or v_scope_space_id is null then
    raise exception 'knowledge_resource_scopes references unknown resource or scope';
  end if;

  if v_resource_space_id <> v_scope_space_id then
    raise exception 'knowledge_resource_scopes must link rows from the same space';
  end if;

  return new;
end;
$$;

create trigger knowledge_resource_scopes_same_space_guard
before insert or update on public.knowledge_resource_scopes
for each row
execute function public.assert_knowledge_resource_scope_same_space();

-- ---------------------------------------------------------------------------
-- dimension 2 — hierarchy: reporting_lines (manager → subordinate, not a graph edge)
-- ---------------------------------------------------------------------------

create table public.reporting_lines (
  id text primary key default public.entity_id_generate('rpl'),
  space_id text not null references public.spaces (id) on delete cascade,
  manager_id uuid not null references auth.users (id) on delete cascade,
  subordinate_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (space_id, manager_id, subordinate_id),
  check (manager_id <> subordinate_id)
);

comment on table public.reporting_lines is
  'Space-scoped manager → subordinate reporting line, an access dimension (not a content-graph edge): managers see resources owned by transitive subordinates. People are auth.users, not graph nodes.';

-- hot path: transitive closure starting from a manager.
create index reporting_lines_space_manager_idx
  on public.reporting_lines (space_id, manager_id);

-- reverse traversal / validation.
create index reporting_lines_space_subordinate_idx
  on public.reporting_lines (space_id, subordinate_id);

-- ---------------------------------------------------------------------------
-- cohort predicate (pure, data-driven sub-function)
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_resource_scope_member(
  p_resource_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- POSITIVE cohort GRANT (ADR-0017 §1.5): true iff the resource is linked to >= 1
  -- cohort the current user belongs to. Unlike a fence, it NEVER defaults true for
  -- an unlinked node — it is an ADDITIVE grant OR-composed on top of the visibility
  -- floor, so it only ever WIDENS access (a private node shared with a cohort
  -- becomes visible to owner + that cohort, nobody else).
  select exists (
    select 1
    from public.knowledge_resource_scopes krs
    join public.scope_memberships sm on sm.scope_id = krs.scope_id
    where krs.resource_id = p_resource_id
      and sm.user_id = (select auth.uid())
  );
$$;

comment on function public.knowledge_resource_scope_member(text) is
  'Cohort GRANT dimension (ADR-0017 §1.5): true iff the resource is linked to >= 1 cohort the current user belongs to. Additive (OR-composed on the visibility floor); never defaults true for an unlinked node. Pure, data-driven, no DDL per cohort.';

revoke all on function public.knowledge_resource_scope_member(text) from public;
grant execute on function public.knowledge_resource_scope_member(text) to authenticated;

-- ---------------------------------------------------------------------------
-- hierarchy predicate (recursive transitive closure; space-checked INSIDE)
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_manages_owner(
  p_resource_owner uuid,
  p_space_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- space membership is checked INSIDE the predicate (ADR-0008 §1) so the OR branch
  -- cannot leak resources across spaces. `union` (not `union all`) dedups → cycle-safe.
  select
    p_resource_owner is not null
    and public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.read')
    and p_resource_owner in (
      with recursive subs as (
        select rl.subordinate_id
        from public.reporting_lines rl
        where rl.manager_id = (select auth.uid())
          and rl.space_id = p_space_id
        union
        select rl.subordinate_id
        from public.reporting_lines rl
        join subs on rl.manager_id = subs.subordinate_id
        where rl.space_id = p_space_id
      )
      select subs.subordinate_id from subs
    );
$$;

comment on function public.auth_user_manages_owner(uuid, text) is
  'Hierarchy dimension: true if the resource owner is a transitive subordinate of the current user within the given space. Space membership is enforced inside the predicate (no cross-space leak).';

revoke all on function public.auth_user_manages_owner(uuid, text) from public;
grant execute on function public.auth_user_manages_owner(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- resource-level composing helper (ADR-0017 §1.5): ONE broadcast floor + grants
--   visible ⟸ is_owner OR (base AND (floor published OR cohort grant)) OR hierarchy
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
  -- OR'd grants. The floor is the single broadcast dial; cohort/role/user grants
  -- only ever WIDEN. is_owner is intrinsic ("you see your own"), hierarchy is the
  -- supervisory branch. Parens are normative (ADR-0008 §1): the base space-membership
  -- check is INSIDE the broadcast/cohort branch so no branch leaks across spaces.
  --
  -- the row's identifying columns (id/space_id/owner_user_id/visibility) are passed
  -- IN by the policy rather than self-fetched: a self-fetch by id cannot see the row
  -- during an INSERT/UPDATE ... RETURNING (the new row is not yet visible to a
  -- sub-query in the same command), which would spuriously deny the RETURNING read.
  -- the only sub-predicate still keyed on id is the cohort grant, which reads the
  -- separate knowledge_resource_scopes table (visible regardless).
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
    -- supervisory oversight (checks space membership INSIDE; no cross-space leak)
    or public.auth_user_manages_owner(p_owner_user_id, p_space_id);
$$;

comment on function public.auth_user_can_access_resource(text, text, uuid, text, text) is
  'Composes knowledge-resource hard-access (ADR-0017 §1.5): is_owner OR (base space+verb AND (visibility floor in space/organization OR cohort grant)) OR manager hierarchy. The single helper every knowledge_resources SELECT policy references; the policy passes the row''s id/space_id/owner_user_id/visibility so it also works under INSERT/UPDATE ... RETURNING.';

revoke all on function public.auth_user_can_access_resource(text, text, uuid, text, text) from public;
grant execute on function public.auth_user_can_access_resource(text, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- rls — new link/hierarchy tables
-- ---------------------------------------------------------------------------

alter table public.knowledge_resource_scopes enable row level security;
alter table public.reporting_lines enable row level security;

revoke all on public.knowledge_resource_scopes from public;
revoke all on public.reporting_lines from public;

grant select, insert, update, delete on public.knowledge_resource_scopes to authenticated;
grant select, insert, update, delete on public.reporting_lines to authenticated;

-- knowledge_resource_scopes — select under read; write under access (keyed on the resource's space).
create policy "knowledge_resource_scopes select for scoped readers"
on public.knowledge_resource_scopes
for select
to authenticated
using (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_scopes.resource_id
      and public.auth_user_can_access_in_space(
        r.space_id,
        'space.knowledge.read'
      )
  )
);

create policy "knowledge_resource_scopes insert for access managers"
on public.knowledge_resource_scopes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_scopes.resource_id
      and public.auth_user_can_access_in_space(
        r.space_id,
        'space.knowledge.access'
      )
  )
);

create policy "knowledge_resource_scopes update for access managers"
on public.knowledge_resource_scopes
for update
to authenticated
using (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_scopes.resource_id
      and public.auth_user_can_access_in_space(
        r.space_id,
        'space.knowledge.access'
      )
  )
)
with check (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_scopes.resource_id
      and public.auth_user_can_access_in_space(
        r.space_id,
        'space.knowledge.access'
      )
  )
);

create policy "knowledge_resource_scopes delete for access managers"
on public.knowledge_resource_scopes
for delete
to authenticated
using (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_scopes.resource_id
      and public.auth_user_can_access_in_space(
        r.space_id,
        'space.knowledge.access'
      )
  )
);

-- reporting_lines — select under read; write under access (keyed on the line's space).
create policy "reporting_lines select for scoped readers"
on public.reporting_lines
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    reporting_lines.space_id,
    'space.knowledge.read'
  )
);

create policy "reporting_lines insert for access managers"
on public.reporting_lines
for insert
to authenticated
with check (
  public.auth_user_can_access_in_space(
    reporting_lines.space_id,
    'space.knowledge.access'
  )
);

create policy "reporting_lines update for access managers"
on public.reporting_lines
for update
to authenticated
using (
  public.auth_user_can_access_in_space(
    reporting_lines.space_id,
    'space.knowledge.access'
  )
)
with check (
  public.auth_user_can_access_in_space(
    reporting_lines.space_id,
    'space.knowledge.access'
  )
);

create policy "reporting_lines delete for access managers"
on public.reporting_lines
for delete
to authenticated
using (
  public.auth_user_can_access_in_space(
    reporting_lines.space_id,
    'space.knowledge.access'
  )
);

-- ---------------------------------------------------------------------------
-- swap the knowledge_resources SELECT policy onto the composing helper
-- (insert/update/delete policies and all knowledge_edges policies are untouched)
-- ---------------------------------------------------------------------------

drop policy "knowledge_resources select for scoped readers" on public.knowledge_resources;

create policy "knowledge_resources select for scoped readers"
on public.knowledge_resources
for select
to authenticated
using (
  public.auth_user_can_access_resource(
    knowledge_resources.id,
    knowledge_resources.space_id,
    knowledge_resources.owner_user_id,
    knowledge_resources.visibility,
    'space.knowledge.read'
  )
);
