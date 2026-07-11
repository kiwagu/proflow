/*
 * knowledge graph — per-user state anchor (see docs/knowledge-graph-plan.md §2).
 *
 * purpose
 * - resource_user_state: a thin per-(user, resource) progress anchor. The cross-app
 *   minimum (coarse_status) the gating layer reads uniformly; rich per-app fine
 *   statuses live on a future child satellite, never here.
 * - powers display gating (locked/unlocked course steps) computed in the projection
 *   layer — authorization (RLS) and gating (computed display state) stay separate.
 *
 * invariants enforced here
 * - own-rows RLS: a user reads/writes ONLY their own rows (user_id = auth.uid()),
 *   and only in spaces they can access. No cross-user reads in this slice.
 * - one state row per (user, resource) — unique(user_id, resource_id); write = upsert.
 * - the row's space_id must equal the resource's space_id (before-trigger guard).
 * - coarse_status is a deliberately small, closed, cross-app CHECK set (the stable
 *   roll-up target), NOT an app-extensibility vocabulary — app richness lives in fine
 *   statuses on a future child satellite (a request to extend this CHECK is a signal
 *   that the value belongs to that fine layer, not the core anchor).
 * - entity-id prefix: rus (resource_user_state) — registered in the architecture
 *   state prefix list.
 *
 * permissions
 * - registers a dedicated write verb space.knowledge.progress (separate from update:
 *   a learner may advance their OWN progress without editing the graph) and maps it
 *   onto admin + author. Reading one's own progress uses space.knowledge.read.
 */

-- ---------------------------------------------------------------------------
-- permission verb — own-progress. READ-TIER: it touches only one's OWN state,
-- so it follows whoever holds space.knowledge.read. The role mapping is the
-- consolidated read-tier derive in 20260623193000 (ADR-0017 §3), NOT a
-- name-by-name grant here.
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description) values
  ('space.knowledge.progress', 'Advance one''s own progress on knowledge resources in one space.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- resource_user_state (per-user progress anchor)
-- ---------------------------------------------------------------------------

create table public.resource_user_state (
  id text primary key default public.entity_id_generate('rus'),
  user_id uuid not null references auth.users (id) on delete cascade,
  resource_id text not null references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  coarse_status text not null default 'not_started'
    check (coarse_status in ('not_started', 'in_progress', 'done', 'blocked')),
  progress integer check (progress is null or (progress >= 0 and progress <= 100)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, resource_id)
);

comment on table public.resource_user_state is
  'Thin per-(user, resource) progress anchor. coarse_status is a closed cross-app roll-up target (CHECK, not a vocabulary); own-rows RLS. Powers display gating, not access.';
comment on column public.resource_user_state.coarse_status is
  'Closed cross-app coarse set (not_started/in_progress/done/blocked). Extending this is a signal the value belongs to a future child satellite''s fine layer, not the core anchor.';
comment on column public.resource_user_state.metadata is
  'jsonb-first child state placeholder (ADR-0004 §7): unused by the POC write-path; a typed satellite earns promotion later.';

-- hot path: overlay fetch by (user, space) — all my rows in a space:
create index resource_user_state_user_space_idx
  on public.resource_user_state (user_id, space_id);

-- groundwork for future cross-user aggregation by resource:
create index resource_user_state_resource_idx
  on public.resource_user_state (resource_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_resource_user_state_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger resource_user_state_set_updated_at
before update on public.resource_user_state
for each row
execute function public.set_resource_user_state_updated_at();

-- ---------------------------------------------------------------------------
-- same-space guard (domain invariant: state row lives in the resource's space)
-- ---------------------------------------------------------------------------

create or replace function public.assert_resource_user_state_same_space()
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
    raise exception 'resource_user_state references unknown resource_id';
  end if;

  if v_resource_space_id <> new.space_id then
    raise exception 'resource_user_state.space_id must equal the resource''s space_id';
  end if;

  return new;
end;
$$;

create trigger resource_user_state_same_space_guard
before insert or update on public.resource_user_state
for each row
execute function public.assert_resource_user_state_same_space();

-- ---------------------------------------------------------------------------
-- rls: own rows only (user_id = auth.uid()) AND scoped verbs
-- ---------------------------------------------------------------------------

alter table public.resource_user_state enable row level security;

revoke all on public.resource_user_state from public;

-- write verb is `progress`; NO delete in this slice (progress is not user-deleted).
grant select, insert, update on public.resource_user_state to authenticated;

-- read one's own progress = part of reading the course (space.knowledge.read);
-- the own-rows predicate already isolates each user's rows.
create policy "resource_user_state select own rows"
on public.resource_user_state
for select
to authenticated
using (
  resource_user_state.user_id = (select auth.uid())
  and public.auth_user_can_access_in_space(
    resource_user_state.space_id,
    'space.knowledge.read'
  )
);

-- write own progress = dedicated verb space.knowledge.progress (NOT update).
create policy "resource_user_state insert own rows"
on public.resource_user_state
for insert
to authenticated
with check (
  resource_user_state.user_id = (select auth.uid())
  and public.auth_user_can_access_in_space(
    resource_user_state.space_id,
    'space.knowledge.progress'
  )
);

create policy "resource_user_state update own rows"
on public.resource_user_state
for update
to authenticated
using (
  resource_user_state.user_id = (select auth.uid())
  and public.auth_user_can_access_in_space(
    resource_user_state.space_id,
    'space.knowledge.progress'
  )
)
with check (
  resource_user_state.user_id = (select auth.uid())
  and public.auth_user_can_access_in_space(
    resource_user_state.space_id,
    'space.knowledge.progress'
  )
);

-- NO cross-user read policy and NO delete policy in this slice (deferred).
