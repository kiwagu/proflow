/*
 * kb.resource_media_meta (kmm) — the generic media-metadata satellite (ADR-0026).
 *
 * The THIRD kb satellite (after resource_description and the Payload body bridge):
 * a 1:1 node attribute carrying the metadata of an uploaded file/video (bucket,
 * storage path, mime, size, original filename, optional checksum/duration). The
 * BYTES live in the private kb-media Storage bucket; this row is only the
 * describing metadata, written after a confirmed upload.
 *
 * It reuses the shared satellite machinery built ONCE in
 * 20260620190000_kb_application_satellites.sql (kb.set_updated_at,
 * kb.assert_satellite_same_space) — this migration only attaches the two triggers
 * and copies the four RLS policies, retargeted to this table. RLS mirrors the
 * parent node's access exactly: read = space.knowledge.read; write =
 * space.knowledge.update. A satellite is visible/editable iff its node is; the
 * denormalized space_id (for RLS performance) is guarded to equal the node's.
 *
 * See docs/knowledge-graph-plan.md for the public plan.
 */

-- ===========================================================================
-- kb.resource_media_meta (kmm) — generic media metadata, 1:1 on a file/video node
-- ===========================================================================
create table kb.resource_media_meta (
  id text primary key default public.entity_id_generate('kmm'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  storage_bucket text not null default 'kb-media',
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  original_filename text not null,
  checksum text null,
  duration_ms integer null,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_media_meta is
  'KB node satellite (1:1): metadata for an uploaded file/video whose bytes live in the private kb-media bucket. Mirrors node access; never a parallel graph.';

create index resource_media_meta_space_id_idx on kb.resource_media_meta (space_id);

-- ---------------------------------------------------------------------------
-- triggers: reuse the shared kb satellite machinery (functions already exist)
-- ---------------------------------------------------------------------------
create trigger resource_media_meta_set_updated_at
before update on kb.resource_media_meta
for each row execute function kb.set_updated_at();

create trigger resource_media_meta_same_space_guard
before insert or update on kb.resource_media_meta
for each row execute function kb.assert_satellite_same_space();

-- ---------------------------------------------------------------------------
-- RLS: mirror the parent node's access (read = read; write = update)
-- ---------------------------------------------------------------------------
alter table kb.resource_media_meta enable row level security;
revoke all on kb.resource_media_meta from public;
grant select, insert, update, delete on kb.resource_media_meta to authenticated;
-- service_role bypasses RLS but still needs the privilege for reconcile jobs.
grant select, insert, update, delete on kb.resource_media_meta to service_role;

create policy "kb_media_meta select mirrors node read"
on kb.resource_media_meta for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.read')
  )
);

create policy "kb_media_meta insert mirrors node update"
on kb.resource_media_meta for insert to authenticated
with check (
  resource_media_meta.created_by = (select auth.uid())
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_media_meta update mirrors node update"
on kb.resource_media_meta for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_media_meta delete mirrors node update"
on kb.resource_media_meta for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_media_meta.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);
