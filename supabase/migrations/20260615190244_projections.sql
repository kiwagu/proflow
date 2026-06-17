/*
 * knowledge graph — projections (see docs/knowledge-graph-plan.md §4).
 *
 * purpose
 * - a business app = a saved ProjectionSpec (filter + traversal + view) over the one graph.
 *   a new app type is a row here, never a new schema or code path (Invariant #1).
 * - spec is stored as jsonb (zod-validated at the app boundary by @workspace/knowledge-contracts);
 *   `view` is duplicated out of spec->>'view' to get an FK against view_types and an index without
 *   cracking the jsonb open. a trigger keeps the two in sync (the db does not validate jsonb shape).
 * - access filters are NOT stored here: access is RLS-derived; the spec filter only narrows.
 *
 * entity-id prefix: prj (registered in the architecture state list).
 *
 * NOTE: this migration creates schema only — NO data rows. The demo projections (knowledge_base
 * and course) are inserted by the separate dev-only seed migration so that adding the second app
 * view stays a pure data change.
 */

create table public.projections (
  id text primary key default public.entity_id_generate('prj'),
  space_id text not null references public.spaces (id) on delete cascade,
  app_type text not null,
  name text not null,
  view text not null references public.view_types (key),
  spec jsonb not null,
  created_by uuid not null,
  owner_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.projections is
  'A business app = a saved ProjectionSpec over the one graph. New app type = a row, zero migration.';
comment on column public.projections.view is
  'Denormalized from spec->>''view'' for FK validation against view_types and indexing; kept in sync by trigger.';

create index projections_space_id_app_type_idx
  on public.projections (space_id, app_type);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_projections_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger projections_set_updated_at
before update on public.projections
for each row
execute function public.set_projections_updated_at();

-- ---------------------------------------------------------------------------
-- view-guard trigger: the denormalized column must equal spec->>'view'
-- ---------------------------------------------------------------------------

create or replace function public.assert_projection_view_matches_spec()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.spec ->> 'view') is distinct from new.view then
    raise exception 'projections.view (%) must equal spec->>''view'' (%)',
      new.view, (new.spec ->> 'view');
  end if;
  return new;
end;
$$;

create trigger projections_view_guard
before insert or update on public.projections
for each row
execute function public.assert_projection_view_matches_spec();

-- ---------------------------------------------------------------------------
-- rls: same space.knowledge.* verbs, keyed on projections.space_id
-- ---------------------------------------------------------------------------

alter table public.projections enable row level security;

revoke all on public.projections from public;

grant select, insert, update, delete on public.projections to authenticated;

create policy "projections select for scoped readers"
on public.projections
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    projections.space_id,
    'space.knowledge.read'
  )
);

create policy "projections insert for scoped creators"
on public.projections
for insert
to authenticated
with check (
  projections.created_by = (select auth.uid())
  and public.auth_user_can_access_in_space(
    projections.space_id,
    'space.knowledge.create'
  )
);

create policy "projections update for scoped editors"
on public.projections
for update
to authenticated
using (
  public.auth_user_can_access_in_space(
    projections.space_id,
    'space.knowledge.update'
  )
)
with check (
  public.auth_user_can_access_in_space(
    projections.space_id,
    'space.knowledge.update'
  )
);

create policy "projections delete for scoped deleters"
on public.projections
for delete
to authenticated
using (
  public.auth_user_can_access_in_space(
    projections.space_id,
    'space.knowledge.delete'
  )
);
