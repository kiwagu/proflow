/*
 * KB application-data layer — node satellites in a dedicated `kb` schema (see
 * docs/knowledge-graph-plan.md). This is the APPLICATION layer, NOT the graph
 * engine: it adds ZERO columns to public.knowledge_resources / knowledge_edges,
 * never introduces its own nodes/edges/topology, and never touches the resolver
 * or the frozen core contracts (schema_version=1). The graph engine stays frozen.
 *
 * satellites-only (the carrying boundary)
 * - every table here is a per-node ATTRIBUTE keyed by node_id ->
 *   public.knowledge_resources(id). There is NO table that relates one KB row to
 *   another KB row (that would be a parallel graph). Any relationship between
 *   nodes is a knowledge_edges row in the single graph. Invariant #1 holds and is
 *   strengthened: a future app hangs its OWN satellites on the SAME nodes.
 *
 * dedicated schema `kb`
 * - the satellites live in a new Postgres schema `kb` (precedent: identity_sync,
 *   space_org_sync, private), physically separating the frozen engine core
 *   (public) from the application KB layer. Cross-schema FK
 *   kb.<t>.node_id -> public.knowledge_resources(id) on delete cascade is native.
 * - exposing `kb` through PostgREST requires PGRST_DB_SCHEMAS += `kb` + grants
 *   (infra change in infra/dev/supabase) — coordinated with this migration.
 *
 * RLS mirror (critical)
 * - a satellite row is visible/writable IFF the parent node is accessible at the
 *   matching verb. Every policy delegates to the landed composing helper
 *   public.auth_user_can_access_resource(node_id, space_id, owner_user_id, verb)
 *   via a join to the PARENT node — never a self-fetch, never a copy of the
 *   predicate. read = space.knowledge.read; write = space.knowledge.update (a node
 *   attribute is authorized under the node's own authority — NOT a space.kb.* verb).
 * - each satellite denormalizes space_id (FK + index) for RLS performance, but the
 *   authority is always the helper keyed on node_id. The all-roles `member` grant
 *   covers these automatically (same read/update verbs).
 *
 * RAG seam
 * - kb.resource_embedding holds ONLY a status (indexed/stale/indexing). There is
 *   NO vector column: pgvector is not in the self-hosted image, and poc-no-fallbacks
 *   forbids faking semantic search. The vector column lands in a future slice as a
 *   single ALTER, with zero rework of this table.
 *
 * entity-id prefixes (registered in the architecture state list):
 *   krd description, krp provenance, kra activity, krl link, krm media-meta,
 *   kre embedding-status.
 */

-- ---------------------------------------------------------------------------
-- schema + usage grants (PostgREST exposure handled in infra PGRST_DB_SCHEMAS)
-- ---------------------------------------------------------------------------

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

-- ===========================================================================
-- kb.resource_provenance (krp) — source: human/imported/ai
-- ===========================================================================

create table kb.resource_provenance (
  id text primary key default public.entity_id_generate('krp'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  source text not null default 'human'
    check (source in ('human', 'imported', 'ai')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_provenance is
  'KB node satellite (1:1): provenance source (human/imported/ai). Closed CHECK, not a vocab (small closed set).';

create index resource_provenance_space_id_idx on kb.resource_provenance (space_id);

-- ===========================================================================
-- kb.resource_activity (kra) — view counter (server-incremented under RLS)
-- ===========================================================================

create table kb.resource_activity (
  id text primary key default public.entity_id_generate('kra'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  view_count bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_activity is
  'KB node satellite (1:1): real view counter. Incremented server-side under the user''s RLS (read access => may increment); never service-role, never faked.';

create index resource_activity_space_id_idx on kb.resource_activity (space_id);

-- ===========================================================================
-- kb.resource_link (krl) — external URL for kind=link
-- ===========================================================================

create table kb.resource_link (
  id text primary key default public.entity_id_generate('krl'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  url text not null,
  host text,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_link is
  'KB node satellite (1:1): external URL of a link node (an attribute, not a graph edge). Optional display host.';

create index resource_link_space_id_idx on kb.resource_link (space_id);

-- ===========================================================================
-- kb.resource_media_meta (krm) — file size / video duration / mime
-- ===========================================================================

create table kb.resource_media_meta (
  id text primary key default public.entity_id_generate('krm'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  byte_size bigint,
  duration_ms bigint,
  mime_type text,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_media_meta is
  'KB node satellite (1:1): kind-specific media meta for file/video (byte size, duration, mime). Form ready even before binary upload lands.';

create index resource_media_meta_space_id_idx on kb.resource_media_meta (space_id);

-- ===========================================================================
-- kb.resource_embedding (kre) — embed STATUS only; vector is a future seam
-- ===========================================================================

create table kb.resource_embedding (
  id text primary key default public.entity_id_generate('kre'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  status text not null default 'stale'
    check (status in ('indexed', 'stale', 'indexing')),
  -- RAG SEAM (do NOT add without pgvector in the image):
  --   embedding vector(1536), indexed_at timestamptz
  -- lands as a single ALTER in a future slice with zero rework of this table.
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_embedding is
  'KB node satellite (1:1): embed STATUS only (indexed/stale/indexing). NO vector column — pgvector is not in the image; the vector seam lands later as one ALTER (poc-no-fallbacks: never fake vector search).';

create index resource_embedding_space_id_idx on kb.resource_embedding (space_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (one function per satellite, set search_path = '')
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

create trigger resource_provenance_set_updated_at
before update on kb.resource_provenance
for each row execute function kb.set_updated_at();

create trigger resource_activity_set_updated_at
before update on kb.resource_activity
for each row execute function kb.set_updated_at();

create trigger resource_link_set_updated_at
before update on kb.resource_link
for each row execute function kb.set_updated_at();

create trigger resource_media_meta_set_updated_at
before update on kb.resource_media_meta
for each row execute function kb.set_updated_at();

create trigger resource_embedding_set_updated_at
before update on kb.resource_embedding
for each row execute function kb.set_updated_at();

-- ---------------------------------------------------------------------------
-- same-space guard: a satellite's denormalized space_id must match its node
-- ---------------------------------------------------------------------------

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
  'Guards every kb satellite: the denormalized space_id (used for RLS performance) must equal the parent node''s space_id.';

create trigger resource_description_same_space_guard
before insert or update on kb.resource_description
for each row execute function kb.assert_satellite_same_space();

create trigger resource_provenance_same_space_guard
before insert or update on kb.resource_provenance
for each row execute function kb.assert_satellite_same_space();

create trigger resource_activity_same_space_guard
before insert or update on kb.resource_activity
for each row execute function kb.assert_satellite_same_space();

create trigger resource_link_same_space_guard
before insert or update on kb.resource_link
for each row execute function kb.assert_satellite_same_space();

create trigger resource_media_meta_same_space_guard
before insert or update on kb.resource_media_meta
for each row execute function kb.assert_satellite_same_space();

create trigger resource_embedding_same_space_guard
before insert or update on kb.resource_embedding
for each row execute function kb.assert_satellite_same_space();

-- ---------------------------------------------------------------------------
-- RLS — every satellite mirrors its node's access via auth_user_can_access_resource
-- read = space.knowledge.read; write = space.knowledge.update.
-- ---------------------------------------------------------------------------

alter table kb.resource_description enable row level security;
alter table kb.resource_provenance enable row level security;
alter table kb.resource_activity enable row level security;
alter table kb.resource_link enable row level security;
alter table kb.resource_media_meta enable row level security;
alter table kb.resource_embedding enable row level security;

revoke all on kb.resource_description from public;
revoke all on kb.resource_provenance from public;
revoke all on kb.resource_activity from public;
revoke all on kb.resource_link from public;
revoke all on kb.resource_media_meta from public;
revoke all on kb.resource_embedding from public;

grant select, insert, update, delete on kb.resource_description to authenticated;
grant select, insert, update, delete on kb.resource_provenance to authenticated;
grant select, insert, update, delete on kb.resource_activity to authenticated;
grant select, insert, update, delete on kb.resource_link to authenticated;
grant select, insert, update, delete on kb.resource_media_meta to authenticated;
grant select, insert, update, delete on kb.resource_embedding to authenticated;

-- service_role bypasses RLS but still needs the table privilege for reconcile jobs.
grant select, insert, update, delete on all tables in schema kb to service_role;

-- == kb.resource_description ================================================

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

-- == kb.resource_provenance =================================================

create policy "kb_provenance select mirrors node read"
on kb.resource_provenance for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_provenance.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

create policy "kb_provenance insert mirrors node update"
on kb.resource_provenance for insert to authenticated
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_provenance.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_provenance update mirrors node update"
on kb.resource_provenance for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_provenance.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_provenance.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_provenance delete mirrors node update"
on kb.resource_provenance for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_provenance.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

-- == kb.resource_activity ===================================================

create policy "kb_activity select mirrors node read"
on kb.resource_activity for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_activity.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

-- view_count is incremented on open: a node a user can READ may have its counter
-- bumped, so activity write mirrors node READ (not update). Still the user's RLS,
-- never service-role.
create policy "kb_activity insert mirrors node read"
on kb.resource_activity for insert to authenticated
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_activity.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

create policy "kb_activity update mirrors node read"
on kb.resource_activity for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_activity.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_activity.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

create policy "kb_activity delete mirrors node update"
on kb.resource_activity for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_activity.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

-- == kb.resource_link =======================================================

create policy "kb_link select mirrors node read"
on kb.resource_link for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

create policy "kb_link insert mirrors node update"
on kb.resource_link for insert to authenticated
with check (
  resource_link.created_by = (select auth.uid())
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_link update mirrors node update"
on kb.resource_link for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_link delete mirrors node update"
on kb.resource_link for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

-- == kb.resource_media_meta =================================================

create policy "kb_media_meta select mirrors node read"
on kb.resource_media_meta for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

create policy "kb_media_meta insert mirrors node update"
on kb.resource_media_meta for insert to authenticated
with check (
  resource_media_meta.created_by = (select auth.uid())
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_media_meta update mirrors node update"
on kb.resource_media_meta for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_media_meta delete mirrors node update"
on kb.resource_media_meta for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

-- == kb.resource_embedding ==================================================

create policy "kb_embedding select mirrors node read"
on kb.resource_embedding for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_embedding.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.read')
  )
);

-- embed status flips to 'stale' when a node's description is edited (update verb).
create policy "kb_embedding insert mirrors node update"
on kb.resource_embedding for insert to authenticated
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_embedding.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_embedding update mirrors node update"
on kb.resource_embedding for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_embedding.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_embedding.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);

create policy "kb_embedding delete mirrors node update"
on kb.resource_embedding for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_embedding.node_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, 'space.knowledge.update')
  )
);
