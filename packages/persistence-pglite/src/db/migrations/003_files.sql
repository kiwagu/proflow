-- Files, v3. Bytes never enter this database: a blob row identifies bytes
-- held by the content-addressed blob store. file_node attaches only bytes
-- metadata to a graph resource; the graph alone owns the content tree.

create table blob (
  hash text primary key,
  size bigint not null,
  mime text not null,
  -- 'local' until a sync target has a copy; 'synced' afterwards.
  sync_state text not null default 'local',
  created_at timestamptz not null default now()
);

create table file_node (
  id text primary key check (public.is_entity_id(id)),
  mime text,
  size bigint,
  blob_hash text not null references blob(hash)
);
