-- Documents and chats, v2. A real Postgres in WASM: entity-id text keys,
-- timestamptz, bytea for CRDT bytes, tsvector for full-text, pgvector for
-- embeddings.
--
-- Every primary key is an entity id minted by the application and CHECKed
-- here, so a row carries the kind it belongs to in its own key.
create extension if not exists vector;

create table document (
  id text primary key check (public.is_entity_id_with_prefix(id, 'doc')),
  title text not null default '',
  kind text not null default 'md',
  preview text not null default '',
  starred boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index document_recent_idx on document (deleted_at, updated_at desc);

-- CRDT state: one full snapshot + an append-only update journal (WAL-style
-- persistence). The snapshot is always a FULL export — a shallow snapshot
-- would discard the history there is no other copy of.
create table document_snapshot (
  document_id text primary key references document(id) on delete cascade,
  bytes bytea not null,
  frontiers jsonb not null,
  op_count int not null default 0,
  updated_at timestamptz not null default now()
);

create table document_update (
  id bigserial primary key,
  document_id text not null references document(id) on delete cascade,
  bytes bytea not null,
  created_at timestamptz not null default now()
);
create index document_update_doc_idx on document_update (document_id, id);

-- Named versions: a frontier is ~50 bytes, so a version costs a row, not a
-- snapshot.
create table document_version (
  id text primary key check (public.is_entity_id_with_prefix(id, 'ver')),
  document_id text not null references document(id) on delete cascade,
  label text,
  kind text not null,
  frontiers jsonb not null,
  created_at timestamptz not null default now()
);
create index document_version_doc_idx on document_version (document_id, created_at desc);

-- Derived cache: the sidebar and search must not import the CRDT. Rebuildable
-- from the snapshot at any time. `writer` names the client whose save
-- produced this row — every tab and the agent worker is a writer with its
-- own id, so a client watching a document skips what it wrote itself and
-- applies everyone else's into its open editor.
create table document_content (
  document_id text primary key references document(id) on delete cascade,
  lexical_json jsonb not null,
  markdown text not null,
  fts tsvector generated always as (to_tsvector('english', markdown)) stored,
  writer text,
  updated_at timestamptz not null default now()
);
create index document_content_fts_idx on document_content using gin (fts);

-- Embeddings are the source of truth (they cost GPU-seconds and would sync);
-- the ANN index is a machine-local, rebuildable projection. Chunk rows are
-- written by one bulk statement, so their ids are minted by the database.
create table document_chunk (
  id text primary key default public.entity_id_generate('chk')
    check (public.is_entity_id_with_prefix(id, 'chk')),
  document_id text not null references document(id) on delete cascade,
  ord int not null,
  char_start int not null,
  text text not null,
  embedding vector(384),
  model_id text not null,
  embedded_at timestamptz
);
create index document_chunk_doc_idx on document_chunk (document_id, ord);
create index document_chunk_embedding_idx on document_chunk
  using hnsw (embedding vector_cosine_ops);

create table chat (
  id text primary key check (public.is_entity_id_with_prefix(id, 'cht')),
  name text not null default '',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index chat_recent_idx on chat (deleted_at, updated_at desc);

create table chat_message (
  id text primary key check (public.is_entity_id_with_prefix(id, 'msg')),
  chat_id text not null references chat(id) on delete cascade,
  role text not null,
  seq int not null,
  text text not null default '',
  model text,
  status text not null default 'complete',
  created_at timestamptz not null default now()
);
create unique index chat_message_seq_idx on chat_message (chat_id, seq);

-- Assistant-turn parts as rows: streaming appends them one at a time, and an
-- interrupted turn must stay representable.
create table chat_message_part (
  id text primary key check (public.is_entity_id_with_prefix(id, 'prt')),
  message_id text not null references chat_message(id) on delete cascade,
  chat_id text not null references chat(id) on delete cascade,
  idx int not null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index chat_message_part_msg_idx on chat_message_part (message_id, idx);
create index chat_message_part_chat_idx on chat_message_part (chat_id, idx);

create table chat_stream (
  id text primary key check (public.is_entity_id_with_prefix(id, 'stm')),
  chat_id text not null references chat(id) on delete cascade,
  message_id text not null,
  status text not null default 'streaming',
  error text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index chat_stream_chat_idx on chat_stream (chat_id, status);

create table setting (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
