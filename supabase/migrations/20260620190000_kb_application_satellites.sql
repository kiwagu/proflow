/*
 * kb application satellites — the dedicated `kb` namespace for per-node satellite
 * data (ADR-0013), established here with its FIRST satellite: resource_description
 * (the RAG-bound description text, 1:1 on any node incl. folders/tags).
 *
 * The `kb` schema + the SHARED satellite machinery (the updated_at stamper and the
 * same-space guard) are built ONCE here and reused by every future satellite
 * (media-meta / link / provenance / activity / embedding) — DRY foundation. Only
 * the satellites the front needs today are created; the rest land with their
 * features (reset-mode: this migration grows to match the authority).
 *
 * RLS mirrors the parent node's access (read = space.knowledge.read; write =
 * space.knowledge.update): a satellite is visible/editable iff the node is. The
 * denormalized space_id (for RLS performance) is guarded to equal the node's.
 * Never a parallel graph — a satellite is 1:1 node data, not a relationship.
 */

create schema if not exists kb;
grant usage on schema kb to anon, authenticated, service_role;

-- ===========================================================================
-- kb.resource_description (krd) — RAG-bound description text, 1:1 on every kind
-- ===========================================================================
create table kb.resource_description (
  id text primary key default public.entity_id_generate('krd'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  body text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_description is
  'KB node satellite (1:1): RAG-bound description text on any node (incl. folder/tag). Mirrors node access; never a parallel graph.';

create index resource_description_space_id_idx on kb.resource_description (space_id);

-- ---------------------------------------------------------------------------
-- shared satellite machinery (reused by every future kb satellite)
-- ---------------------------------------------------------------------------
create or replace function kb.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

comment on function kb.set_updated_at() is
  'Shared BEFORE UPDATE trigger for kb satellites: stamps updated_at in UTC.';

create trigger resource_description_set_updated_at
before update on kb.resource_description
for each row execute function kb.set_updated_at();

create or replace function kb.assert_satellite_same_space()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_node_space_id text;
begin
  select r.space_id into v_node_space_id
  from public.knowledge_resources r
  where r.id = new.node_id;

  if v_node_space_id is null then
    raise exception 'kb satellite references unknown node_id %', new.node_id;
  end if;

  if v_node_space_id <> new.space_id then
    raise exception 'kb satellite space_id must match its node''s space_id';
  end if;

  return new;
end;
$$;

comment on function kb.assert_satellite_same_space() is
  'Guards every kb satellite: the denormalized space_id (for RLS performance) must equal the parent node''s space_id.';

create trigger resource_description_same_space_guard
before insert or update on kb.resource_description
for each row execute function kb.assert_satellite_same_space();

-- ---------------------------------------------------------------------------
-- RLS: mirror the parent node's access (read = read; write = update)
-- ---------------------------------------------------------------------------
alter table kb.resource_description enable row level security;
revoke all on kb.resource_description from public;
grant select, insert, update, delete on kb.resource_description to authenticated;
-- service_role bypasses RLS but still needs the privilege for reconcile jobs.
grant select, insert, update, delete on all tables in schema kb to service_role;

create policy "kb_description select mirrors node read"
on kb.resource_description for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_description.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

create policy "kb_description insert mirrors node update"
on kb.resource_description for insert to authenticated
with check (
  resource_description.created_by = (select auth.uid())
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_description.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_description update mirrors node update"
on kb.resource_description for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_description.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_description.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_description delete mirrors node update"
on kb.resource_description for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_description.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);
