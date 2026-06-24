/*
 * knowledge graph — nodes + directed edges (see docs/knowledge-graph-plan.md §1).
 *
 * purpose
 * - knowledge_resources: a single polymorphic graph node (kind is a vocabulary, not an enum).
 * - knowledge_edges: a directed edge as an adjacency-list row with a uniform shape
 *   (relation_type + position + metadata) — a new relation is a vocabulary row, not a schema change.
 * - both tables are space-scoped and protected by RLS via auth_user_can_access_in_space().
 *
 * invariants enforced here
 * - an edge connects only nodes of the SAME space (before-trigger guard, not a per-policy join).
 * - from_id <> to_id (no length-1 self loops in this slice).
 * - entity-id prefixes: knr (node), kne (edge) — registered in the architecture state list.
 *
 * permissions
 * - registers the space.knowledge.* verb namespace and maps it onto the existing space roles:
 *   admin -> read/create/update/delete; author -> read/create/update (NOT delete, parity with content-author).
 *
 * note: status/visibility are inline checks (coarse placeholders). workflow-as-data and a status
 * vocabulary are deliberately out of this slice; kind/relation_type/view are already vocabularies.
 */

-- ---------------------------------------------------------------------------
-- permission verbs + role mapping
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description) values
  ('space.knowledge.read', 'Read knowledge resources and edges in one space.'),
  ('space.knowledge.create', 'Create knowledge resources and edges in one space.'),
  ('space.knowledge.update', 'Update knowledge resources and edges in one space.'),
  ('space.knowledge.delete', 'Delete knowledge resources and edges in one space.')
on conflict (key) do nothing;

-- ADR-0017 D5-revision (personal authoring): EVERY space member can author their
-- OWN content (a private-by-default personal KB / "Drive"). So `member` holds
-- read + create (open/progress derive from read, 20260623193000). update/delete are
-- NOT granted to member as verbs — the owner-sovereign UPDATE/DELETE policies below
-- let an owner edit/delete their OWN node without the verb; the verb is what lets
-- author/admin act CROSS-owner. (Group co-authoring — a cohort editing a shared node
-- — is a separate, deferred dimension.)
with mapping(role_key, permission_key) as (
  values
    ('admin', 'space.knowledge.read'),
    ('admin', 'space.knowledge.create'),
    ('admin', 'space.knowledge.update'),
    ('admin', 'space.knowledge.delete'),
    ('author', 'space.knowledge.read'),
    ('author', 'space.knowledge.create'),
    ('author', 'space.knowledge.update'),
    ('member', 'space.knowledge.read'),
    ('member', 'space.knowledge.create')
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
-- knowledge_resources (graph node)
-- ---------------------------------------------------------------------------

create table public.knowledge_resources (
  id text primary key default public.entity_id_generate('knr'),
  space_id text not null references public.spaces (id) on delete cascade,
  kind text not null references public.resource_kinds (key),
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  -- broadcast floor (ADR-0017 §1.5). default 'private' = private-by-default /
  -- fail-closed draft (Step 3, the deliberate one-way flip): a NEW node is a private
  -- draft until its owner consciously publishes (floor→space) or shares to a cohort.
  -- The audience widens only by a deliberate act (owner-sovereign, D9). `visibility`
  -- (access floor) is orthogonal to `status` (workflow) — never merge them.
  visibility text not null default 'private'
    check (visibility in ('private', 'space', 'organization')),
  body_ref jsonb,
  created_by uuid not null,
  owner_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.knowledge_resources is
  'Polymorphic knowledge-graph node. kind/status are data, not enums; space-scoped under RLS.';
comment on column public.knowledge_resources.body_ref is
  'Nullable pointer {collection, doc_id} to a Payload rich-text body for kind=text. Bridge deferred — slice 01.';

create index knowledge_resources_space_id_kind_idx
  on public.knowledge_resources (space_id, kind);

create index knowledge_resources_space_id_status_idx
  on public.knowledge_resources (space_id, status);

-- ---------------------------------------------------------------------------
-- knowledge_edges (directed edge)
-- ---------------------------------------------------------------------------

create table public.knowledge_edges (
  id text primary key default public.entity_id_generate('kne'),
  space_id text not null references public.spaces (id) on delete cascade,
  from_id text not null references public.knowledge_resources (id) on delete cascade,
  to_id text not null references public.knowledge_resources (id) on delete cascade,
  relation_type text not null references public.relation_types (key),
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (from_id <> to_id)
);

comment on table public.knowledge_edges is
  'Directed edge in the knowledge graph (adjacency list). Uniform shape relation_type+position+metadata: a new relation is a vocabulary row, not a schema change.';

-- hot-path traversal indexes (forward + reverse), for recursive-CTE traversal:
create index knowledge_edges_from_relation_position_idx
  on public.knowledge_edges (from_id, relation_type, position);

create index knowledge_edges_to_relation_position_idx
  on public.knowledge_edges (to_id, relation_type, position);

create index knowledge_edges_space_id_idx
  on public.knowledge_edges (space_id);

-- prevent duplicate parallel edges of the same type/direction:
create unique index knowledge_edges_from_to_relation_uniq
  on public.knowledge_edges (from_id, to_id, relation_type);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_knowledge_resources_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger knowledge_resources_set_updated_at
before update on public.knowledge_resources
for each row
execute function public.set_knowledge_resources_updated_at();

create or replace function public.set_knowledge_edges_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger knowledge_edges_set_updated_at
before update on public.knowledge_edges
for each row
execute function public.set_knowledge_edges_updated_at();

-- ---------------------------------------------------------------------------
-- same-space guard for edges (domain invariant: an edge stays inside one space)
-- ---------------------------------------------------------------------------

create or replace function public.assert_knowledge_edge_same_space()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_from_space_id text;
  v_to_space_id text;
begin
  select r.space_id into v_from_space_id
  from public.knowledge_resources r
  where r.id = new.from_id;

  select r.space_id into v_to_space_id
  from public.knowledge_resources r
  where r.id = new.to_id;

  if v_from_space_id is null or v_to_space_id is null then
    raise exception 'knowledge_edges references unknown from_id or to_id';
  end if;

  if v_from_space_id <> new.space_id or v_to_space_id <> new.space_id then
    raise exception 'knowledge_edges must connect resources from the same space as the edge';
  end if;

  return new;
end;
$$;

create trigger knowledge_edges_same_space_guard
before insert or update on public.knowledge_edges
for each row
execute function public.assert_knowledge_edge_same_space();

-- ---------------------------------------------------------------------------
-- rls
-- ---------------------------------------------------------------------------

alter table public.knowledge_resources enable row level security;
alter table public.knowledge_edges enable row level security;

revoke all on public.knowledge_resources from public;
revoke all on public.knowledge_edges from public;

grant select, insert, update, delete on public.knowledge_resources to authenticated;
grant select, insert, update, delete on public.knowledge_edges to authenticated;

-- knowledge_resources
create policy "knowledge_resources select for scoped readers"
on public.knowledge_resources
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    knowledge_resources.space_id,
    'space.knowledge.read'
  )
);

create policy "knowledge_resources insert for scoped creators"
on public.knowledge_resources
for insert
to authenticated
with check (
  knowledge_resources.created_by = (select auth.uid())
  and public.auth_user_can_access_in_space(
    knowledge_resources.space_id,
    'space.knowledge.create'
  )
);

-- OWNER-SOVEREIGN authoring (ADR-0017 D5-revision): an owner may edit/delete their
-- OWN content (their personal KB) without the verb; the `update`/`delete` verb is what
-- lets author/admin act CROSS-owner. The visibility floor change inside an UPDATE is
-- further gated owner-sovereign by the D9 trigger (assert_visibility_change_authorized,
-- 20260624120000).
create policy "knowledge_resources update for scoped editors"
on public.knowledge_resources
for update
to authenticated
using (
  knowledge_resources.owner_user_id = (select auth.uid())
  or public.auth_user_can_access_in_space(
    knowledge_resources.space_id,
    'space.knowledge.update'
  )
)
with check (
  knowledge_resources.owner_user_id = (select auth.uid())
  or public.auth_user_can_access_in_space(
    knowledge_resources.space_id,
    'space.knowledge.update'
  )
);

create policy "knowledge_resources delete for scoped deleters"
on public.knowledge_resources
for delete
to authenticated
using (
  knowledge_resources.owner_user_id = (select auth.uid())
  or public.auth_user_can_access_in_space(
    knowledge_resources.space_id,
    'space.knowledge.delete'
  )
);

-- knowledge_edges (keyed on the edge's own space_id; same-space guard keeps it consistent)
create policy "knowledge_edges select for scoped readers"
on public.knowledge_edges
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    knowledge_edges.space_id,
    'space.knowledge.read'
  )
);

create policy "knowledge_edges insert for scoped creators"
on public.knowledge_edges
for insert
to authenticated
with check (
  knowledge_edges.created_by = (select auth.uid())
  and public.auth_user_can_access_in_space(
    knowledge_edges.space_id,
    'space.knowledge.create'
  )
);

-- OWNER-SOVEREIGN edge wiring (ADR-0017 D5-revision): the author of an edge
-- (`created_by` — there is no `owner_user_id` on edges) may update/delete their OWN
-- wiring (untag, unlink, move) without the verb; the verb lets author/admin manage
-- edges CROSS-author. Node deletion still cascades its edges via the FK regardless.
create policy "knowledge_edges update for scoped editors"
on public.knowledge_edges
for update
to authenticated
using (
  knowledge_edges.created_by = (select auth.uid())
  or public.auth_user_can_access_in_space(
    knowledge_edges.space_id,
    'space.knowledge.update'
  )
)
with check (
  knowledge_edges.created_by = (select auth.uid())
  or public.auth_user_can_access_in_space(
    knowledge_edges.space_id,
    'space.knowledge.update'
  )
);

create policy "knowledge_edges delete for scoped deleters"
on public.knowledge_edges
for delete
to authenticated
using (
  knowledge_edges.created_by = (select auth.uid())
  or public.auth_user_can_access_in_space(
    knowledge_edges.space_id,
    'space.knowledge.delete'
  )
);
