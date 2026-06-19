/*
 * knowledge graph — vocabularies as data (see docs/knowledge-graph-plan.md §1).
 *
 * purpose
 * - reference tables that type the knowledge graph: resource_kinds, relation_types, view_types.
 * - these are platform configuration, NOT postgres enums: adding a new kind/relation/view is
 *   one insert and zero migration. this is what lets a business app be data, not a new schema.
 *
 * natural-key pk exception (documented)
 * - vocabularies use a human-readable `key text primary key` (e.g. 'text', 'relates_to', 'grid'),
 *   not entity_id_generate. these keys are referenced by foreign keys from the hot graph tables
 *   and embedded as literals inside ProjectionSpec jsonb; a ulid id there would be unreadable and
 *   non-portable across environments. this is an allowed "stable external/reference key" exception
 *   to db-domain-ids-and-naming (no new entity-id prefixes are registered for vocabularies).
 *
 * rls
 * - vocabularies are global reference data, NOT space-scoped domain resources. select is granted
 *   to authenticated (= true); there are no write policies — vocabularies change only via migration.
 *   this is an explicit, allowed exception to the space-scoped-resource canon.
 */

-- ---------------------------------------------------------------------------
-- vocabulary tables
-- ---------------------------------------------------------------------------

create table public.resource_kinds (
  key text primary key,
  label text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.resource_kinds is
  'Vocabulary (data, not enum): polymorphic resource kinds. New kind = one insert, zero migration.';

create table public.relation_types (
  key text primary key,
  label text not null,
  description text,
  is_directed boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.relation_types is
  'Vocabulary (data, not enum): directed edge relation types. New relation = one insert, zero migration.';

create table public.view_types (
  key text primary key,
  label text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.view_types is
  'Vocabulary (data, not enum): projection view types. New view = one insert, zero migration.';

-- ---------------------------------------------------------------------------
-- seed (minimum needed for the slice; extensible by adding rows)
-- ---------------------------------------------------------------------------

insert into public.resource_kinds (key, label, description) values
  ('text', 'Text', 'Rich-text body authored in Payload (kind=text).'),
  ('link', 'Link', 'Reference to another resource or external URL.'),
  ('tag', 'Tag', 'A tag node; resources point at it with a tagged edge (tags are data, not a column).'),
  ('folder', 'Folder', 'Container node; holds children via a contains edge. Body-less, like a tag.'),
  ('file', 'File', 'Uploaded binary asset (PDF/zip/etc.); attributes live on kb.resource_media_meta.'),
  ('video', 'Video', 'Video resource; attributes live on kb.resource_media_meta.')
on conflict (key) do nothing;

insert into public.relation_types (key, label, description, is_directed) values
  ('relates_to', 'Relates to', 'Associative, non-hierarchical link.', true),
  ('part_of', 'Part of', 'Hierarchical containment (child part_of parent); reserved for part-of-whole (e.g. course sub-DAG).', true),
  ('prerequisite', 'Prerequisite', 'Source must precede target (pacing/ordering).', true),
  ('tagged', 'Tagged', 'Resource tagged into a tag node (from_id=resource, to_id=tag).', true),
  ('contains', 'Contains', 'Folder holds child, forward containment (from_id=folder, to_id=child); breadcrumb/descendants walk this only.', true),
  ('shortcut', 'Shortcut to', 'Cross-folder symlink (from_id=folder, to_id=target); rendered in Drive, excluded from containment traversal.', true)
on conflict (key) do nothing;

insert into public.view_types (key, label, description) values
  ('grid', 'Grid', 'Card/grid layout.'),
  ('list', 'List', 'Flat list layout.'),
  ('course', 'Course', 'Ordered curriculum view following prerequisite edges.'),
  ('lens', 'Lens', 'Node+edge navigator: hub rail, kind/tag slice and resource panel over the live graph.'),
  ('board', 'Board', 'Status-segmented board view.'),
  ('drive', 'Drive', 'Folder tree + grid; the graph hidden behind a familiar tree.'),
  ('notion', 'Notion', 'Nested pages + inline mentions + backlinks.'),
  ('graph', 'Graph', 'Spatial focus+neighborhood ego map; re-center to walk the connections.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- rls: global reference data, readable by any authenticated user; no writes
-- ---------------------------------------------------------------------------

alter table public.resource_kinds enable row level security;
alter table public.relation_types enable row level security;
alter table public.view_types enable row level security;

revoke all on public.resource_kinds from public;
revoke all on public.relation_types from public;
revoke all on public.view_types from public;

grant select on public.resource_kinds to authenticated;
grant select on public.relation_types to authenticated;
grant select on public.view_types to authenticated;

create policy "resource_kinds readable by authenticated"
on public.resource_kinds
for select
to authenticated
using (true);

create policy "relation_types readable by authenticated"
on public.relation_types
for select
to authenticated
using (true);

create policy "view_types readable by authenticated"
on public.view_types
for select
to authenticated
using (true);

-- no insert/update/delete policies: vocabularies change only via migration seed.
