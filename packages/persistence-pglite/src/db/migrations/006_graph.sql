-- Graph workbench replica, v1. The local projection of the user's
-- RLS-visible subgraph of each checked-out space: server rows under the
-- server's own names and column shapes (mechanical mapping, no rename
-- layer). The server remains the sole authority for these rows — a local
-- write is a proposal recorded in the op journal until the server accepts
-- it; the replica converges to the server, never the reverse.
--
-- Deliberate differences from the server schema, all consequences of being
-- a replica rather than a peer:
--
--   * No RLS, no grant machinery — the replica only ever holds what the
--     server already showed THIS user; access is enforced at the source.
--   * No foreign keys to spaces/users (those tables are not replicated)
--     and none between graph tables: pull batches per table are
--     independent, so an edge may land before its node. The server owns
--     referential integrity; the replica mirrors its outcome.
--   * No CHECK on value domains the server may widen (status, kinds,
--     relation types are vocabulary DATA server-side) — a replica must
--     never refuse a row the server accepted.
--   * Per-user state is own-rows-only by construction: the pull runs under
--     the user's identity, so `resource_user_state` here never contains
--     another user's rows.

-- ---------------------------------------------------------------------------
-- knowledge_resources (graph node) — replicates both ways
-- ---------------------------------------------------------------------------
create table knowledge_resources (
  id text primary key check (public.is_entity_id_with_prefix(id, 'knr')),
  space_id text not null,
  kind text not null,
  title text not null,
  status text not null default 'draft',
  -- broadcast floor: private / space / organization. Kept loose (see header).
  visibility text not null default 'private',
  workflow_key text,
  body_ref jsonb,
  created_by uuid not null,
  owner_user_id uuid,
  -- trash is not a table: existence lens over these two columns.
  deleted_at timestamptz,
  trashed_by uuid,
  -- edit recency roll-up (node + body + satellite + edge, excluding opens);
  -- server-maintained, mirrored here so the "Modified" column reads locally.
  last_modified_at timestamptz not null default now(),
  -- activity recency (also counts opens); server-maintained.
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_resources_space_kind_idx
  on knowledge_resources (space_id, kind);
create index knowledge_resources_space_status_idx
  on knowledge_resources (space_id, status);
-- the existence lens (live vs trashed) filters on deleted_at per space:
create index knowledge_resources_space_deleted_idx
  on knowledge_resources (space_id, deleted_at);
-- Full text over titles is DERIVED locally (never synced): the lens search
-- box resolves against this instead of the server's search route. `simple`
-- (no stemming, no stop words) is the configuration a title type-ahead
-- wants — a stemmer would make a prefix match on a short token miss.
create index knowledge_resources_title_fts_idx
  on knowledge_resources using gin (to_tsvector('simple', title));

-- ---------------------------------------------------------------------------
-- knowledge_edges (directed edge) — replicates both ways
-- ---------------------------------------------------------------------------
create table knowledge_edges (
  id text primary key check (public.is_entity_id_with_prefix(id, 'kne')),
  space_id text not null,
  from_id text not null,
  to_id text not null,
  relation_type text not null,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id)
);

-- the natural key structural ops upsert on (mirrors the server's uniqueness):
create unique index knowledge_edges_from_to_relation_uniq
  on knowledge_edges (from_id, to_id, relation_type);
-- forward + reverse traversal for the containment forest CTE:
create index knowledge_edges_from_relation_position_idx
  on knowledge_edges (from_id, relation_type, position);
create index knowledge_edges_to_relation_position_idx
  on knowledge_edges (to_id, relation_type, position);
create index knowledge_edges_space_id_idx
  on knowledge_edges (space_id);

-- ---------------------------------------------------------------------------
-- resource_user_state (per-user anchor) — own rows only, both ways
-- ---------------------------------------------------------------------------
create table resource_user_state (
  id text primary key check (public.is_entity_id_with_prefix(id, 'rus')),
  user_id uuid not null,
  resource_id text not null,
  space_id text not null,
  coarse_status text not null default 'not_started',
  progress integer check (progress is null or (progress >= 0 and progress <= 100)),
  starred boolean not null default false,
  last_opened_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resource_id)
);

create index resource_user_state_user_space_idx
  on resource_user_state (user_id, space_id);
create index resource_user_state_starred_idx
  on resource_user_state (space_id) where starred;

-- ---------------------------------------------------------------------------
-- kb satellites the cards/panel read. The server keeps them in a dedicated
-- schema; locally they live flat under a `kb_` prefix (one local schema, the
-- same rule the pack store applies everywhere). Description syncs both ways;
-- link and media are down-only in v1.
-- ---------------------------------------------------------------------------
create table kb_resource_description (
  id text primary key check (public.is_entity_id_with_prefix(id, 'krd')),
  node_id text not null unique,
  space_id text not null,
  body text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kb_resource_description_space_idx
  on kb_resource_description (space_id);

create table kb_resource_link (
  id text primary key check (public.is_entity_id_with_prefix(id, 'krl')),
  node_id text not null unique,
  space_id text not null,
  url text not null,
  host text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kb_resource_link_space_idx
  on kb_resource_link (space_id);

-- Shared byte record: byte-intrinsic fields live here, one row per blob no
-- matter how many nodes reference it. Down-only; refcount is server-owned
-- and mirrored untouched.
create table kb_media_blob (
  id text primary key check (public.is_entity_id_with_prefix(id, 'kmb')),
  space_id text not null,
  storage_bucket text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text,
  duration_ms integer,
  refcount integer not null default 0,
  provenance_author_id uuid,
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kb_media_blob_space_idx on kb_media_blob (space_id);

create table kb_resource_media_meta (
  id text primary key check (public.is_entity_id_with_prefix(id, 'kmm')),
  node_id text not null unique,
  space_id text not null,
  blob_id text not null,
  original_filename text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kb_resource_media_meta_space_idx
  on kb_resource_media_meta (space_id);
create index kb_resource_media_meta_blob_idx
  on kb_resource_media_meta (blob_id);

-- ---------------------------------------------------------------------------
-- sync ledger. Same pattern as document_sync: per-(space, table) pull
-- cursors, plus the ordered journal of local structural commands a sync
-- worker replays against the server, at-least-once. Every op is idempotent
-- by construction, so redelivery is harmless without dedup machinery.
-- ---------------------------------------------------------------------------
create table graph_row_sync (
  space_id text not null,
  table_name text not null,
  -- watermark over server updated_at; the puller re-reads a small overlap
  -- window below it so clock ties cannot skip rows.
  cursor timestamptz,
  -- when the id inventory diff (purge/revocation sweep) last completed.
  inventory_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (space_id, table_name)
);

create table graph_op_journal (
  id bigserial primary key,
  space_id text not null,
  op text not null,
  payload jsonb not null,
  -- every node the op touches: rejection reconciliation drops all journaled
  -- ops depending on the same node, then re-pulls those rows.
  node_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index graph_op_journal_space_idx on graph_op_journal (space_id, id);
-- rejection reconciliation asks which journaled ops touch a given node:
create index graph_op_journal_node_ids_idx on graph_op_journal using gin (node_ids);
