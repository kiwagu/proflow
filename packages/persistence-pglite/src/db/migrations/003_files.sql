-- Files, v3. Bytes never enter this database: a blob row is the identity of
-- bytes held by the blob store (content-addressed, so the hash IS the key),
-- and a file node is what the explorer shows — a folder, a native document,
-- or a blob-backed file carrying its MIME type.

create table blob (
  hash text primary key,
  size bigint not null,
  mime text not null,
  -- 'local' until a sync target has a copy; 'synced' afterwards.
  sync_state text not null default 'local',
  created_at timestamptz not null default now()
);

create table file_node (
  id text primary key check (public.is_entity_id_with_prefix(id, 'fil')),
  parent_id text references file_node(id) on delete cascade,
  kind text not null check (kind in ('folder', 'document', 'blob')),
  name text not null,
  mime text,
  size bigint,
  blob_hash text references blob(hash),
  document_id text references document(id) on delete cascade,
  starred boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (kind = 'folder' and blob_hash is null and document_id is null) or
    (kind = 'document' and document_id is not null and blob_hash is null) or
    (kind = 'blob' and blob_hash is not null and document_id is null)
  )
);
create index file_node_parent_idx on file_node (parent_id, deleted_at);
create unique index file_node_document_idx on file_node (document_id)
  where document_id is not null;
