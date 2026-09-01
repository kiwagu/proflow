/*
 * server document search: server-side embeddings + hybrid search over synced
 * documents.
 *
 * purpose
 *   clients hold their own local search index (vectors + fts in the in-browser
 *   database) and never sync it: embeddings are a derived projection of
 *   document content, tied to the model that produced them, and each replica
 *   recomputes its own. the server mirrors that posture — it computes its OWN
 *   chunk embeddings from the canonical CRDT byte stream via a background
 *   derive worker (the one server component that opens documents), and serves
 *   the same hybrid query shape (vector leg + fts leg, reciprocal-rank fusion)
 *   to consumers that have no local replica: agents, API surfaces.
 *
 *   the two engines never mix vectors. a query is embedded by the engine that
 *   runs it, with that engine's pinned model. the tables here are a projection
 *   and are allowed to be truncated: the derive worker rebuilds them from the
 *   document stream (snapshot + update tail) from nothing.
 *
 * schema
 *   - server_document_chunk: one row per chunk window — text, embedding
 *     (384-dim vector, hnsw cosine), model_id, and a generated tsvector for
 *     the fts leg. bulk-replaced per document by the derive worker.
 *   - server_document_index_state: per-document derive bookkeeping — the
 *     watermark the index covers (max of folded snapshot_seq and update tail),
 *     the model that produced it, and the derived title used by search
 *     results (content bytes are opaque to every other server path, so the
 *     title must be captured at derive time).
 *
 * access model (rls, fail-closed)
 *   - reads mirror document reads: space.documents.read via
 *     auth_user_can_access_in_space, same fence as crdt_documents.
 *   - NO write policies on either table: the only writer is the derive worker
 *     over the service role, through rpc_replace_server_document_chunks.
 *     client-computed vectors are deliberately not accepted — a client could
 *     push vectors that do not match the content, and replicas may pin
 *     different models.
 *
 * rpcs
 *   - rpc_search_server_documents: the hybrid search read. SECURITY INVOKER —
 *     rls does the fencing; the function only shapes the query.
 *   - rpc_list_documents_to_index / rpc_replace_server_document_chunks:
 *     derive-worker plumbing, service_role only (revoked from everyone else).
 *     invoker security: service_role's own table grants are sufficient, so no
 *     definer escalation is needed.
 */

-- ---------------------------------------------------------------------------
-- pgvector (extensions schema, never public)
-- ---------------------------------------------------------------------------

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- server_document_chunk
-- ---------------------------------------------------------------------------

create table public.server_document_chunk (
  document_id text not null references public.crdt_documents (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  ord int not null,
  char_start int not null,
  text text not null,
  embedding extensions.vector(384) not null,
  model_id text not null,
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  embedded_at timestamptz not null default timezone('utc', now()),
  primary key (document_id, ord)
);

comment on table public.server_document_chunk is
  'Server-computed chunk embeddings + fts projection over synced documents. Derived from the CRDT stream by the derive worker; rebuildable from nothing; never accepts client-computed vectors.';

create index server_document_chunk_embedding_idx
  on public.server_document_chunk
  using hnsw (embedding extensions.vector_cosine_ops);

create index server_document_chunk_fts_idx
  on public.server_document_chunk using gin (fts);

create index server_document_chunk_space_id_idx
  on public.server_document_chunk (space_id);

alter table public.server_document_chunk enable row level security;

create policy "server_document_chunk select mirrors document read"
on public.server_document_chunk
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    server_document_chunk.space_id,
    'space.documents.read'
  )
);

-- no insert/update/delete policies on purpose: the derive worker (service
-- role) is the only writer (see header).

revoke all on table public.server_document_chunk from anon;
revoke insert, update, delete on table public.server_document_chunk from authenticated;

-- ---------------------------------------------------------------------------
-- server_document_index_state
-- ---------------------------------------------------------------------------

create table public.server_document_index_state (
  document_id text primary key references public.crdt_documents (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  -- derived at index time from the document content; the only server-readable
  -- title of a synced document (content bytes are opaque elsewhere).
  title text not null default '',
  -- the document stream position this index covers:
  -- greatest(snapshot_seq, max update seq) at derive time. monotone under
  -- compaction, so the worker can tail by comparing watermarks.
  indexed_watermark bigint not null default 0,
  model_id text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.server_document_index_state is
  'Per-document derive bookkeeping for the server search index: covered watermark, embedding model, derived title.';

alter table public.server_document_index_state enable row level security;

create index server_document_index_state_space_id_idx
  on public.server_document_index_state (space_id);

create policy "server_document_index_state select mirrors document read"
on public.server_document_index_state
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    server_document_index_state.space_id,
    'space.documents.read'
  )
);

-- no write policies on purpose: derive worker only (see header).

revoke all on table public.server_document_index_state from anon;
revoke insert, update, delete on table public.server_document_index_state from authenticated;

-- ---------------------------------------------------------------------------
-- derive-worker rpcs (service_role only)
-- ---------------------------------------------------------------------------

-- which documents need (re)indexing: stream moved past the covered watermark,
-- or the index was built by another model. one round trip for the whole plan.
create or replace function public.rpc_list_documents_to_index(
  p_model_id text
)
returns table (
  document_id text,
  space_id text,
  watermark bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id as document_id,
         d.space_id,
         greatest(d.snapshot_seq, coalesce(max(u.seq), 0)) as watermark
  from public.crdt_documents d
  left join public.crdt_updates u on u.doc_id = d.id
  left join public.server_document_index_state s on s.document_id = d.id
  group by d.id, d.space_id, d.snapshot_seq, s.indexed_watermark, s.model_id
  having greatest(d.snapshot_seq, coalesce(max(u.seq), 0))
           > coalesce(s.indexed_watermark, 0)
      or s.model_id is distinct from p_model_id;
$$;

comment on function public.rpc_list_documents_to_index(text) is
  'Derive-worker plan: documents whose CRDT stream moved past the indexed watermark or whose index was built by another model. service_role only.';

revoke all on function public.rpc_list_documents_to_index(text) from public;
revoke all on function public.rpc_list_documents_to_index(text) from anon;
revoke all on function public.rpc_list_documents_to_index(text) from authenticated;
grant execute on function public.rpc_list_documents_to_index(text) to service_role;

-- atomic bulk replace of one document's chunk rows + bookkeeping upsert.
-- replaces rows from an older model too, so a document always has exactly one
-- current representation. p_chunks: jsonb array of
-- { ord, char_start, text, embedding: [float, ...] }.
create or replace function public.rpc_replace_server_document_chunks(
  p_document_id text,
  p_space_id text,
  p_model_id text,
  p_title text,
  p_watermark bigint,
  p_chunks jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  delete from public.server_document_chunk c
  where c.document_id = p_document_id;

  insert into public.server_document_chunk
    (document_id, space_id, ord, char_start, text, embedding, model_id)
  select p_document_id,
         p_space_id,
         (c.value ->> 'ord')::int,
         (c.value ->> 'char_start')::int,
         c.value ->> 'text',
         (c.value ->> 'embedding')::extensions.vector(384),
         p_model_id
  from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as c;

  insert into public.server_document_index_state as s
    (document_id, space_id, title, indexed_watermark, model_id, updated_at)
  values
    (p_document_id, p_space_id, coalesce(p_title, ''), coalesce(p_watermark, 0),
     p_model_id, timezone('utc', now()))
  on conflict (document_id) do update
    set space_id = excluded.space_id,
        title = excluded.title,
        -- watermarks only advance; a racing older pass must not regress one.
        indexed_watermark = greatest(s.indexed_watermark, excluded.indexed_watermark),
        model_id = excluded.model_id,
        updated_at = timezone('utc', now());
end;
$$;

comment on function public.rpc_replace_server_document_chunks(text, text, text, text, bigint, jsonb) is
  'Derive-worker write: bulk-replace one document''s server chunks (any model) and upsert its index bookkeeping. service_role only.';

revoke all on function public.rpc_replace_server_document_chunks(text, text, text, text, bigint, jsonb) from public;
revoke all on function public.rpc_replace_server_document_chunks(text, text, text, text, bigint, jsonb) from anon;
revoke all on function public.rpc_replace_server_document_chunks(text, text, text, text, bigint, jsonb) from authenticated;
grant execute on function public.rpc_replace_server_document_chunks(text, text, text, text, bigint, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- search rpc (authenticated; rls is the fence)
-- ---------------------------------------------------------------------------

-- hybrid search over the server index. two legs, each with its own index:
-- the VECTOR leg ranks chunks by cosine distance (hnsw), the FTS leg ranks
-- documents by web-style term matching (gin over the generated tsvector).
-- reciprocal-rank fusion combines them without making their scores
-- comparable — only the ranks matter. the caller embeds the query with the
-- server's pinned model and passes the vector; the function never mixes
-- models (vector leg filters on p_model_id).
--
-- SECURITY INVOKER: every table touched here carries the space.documents.read
-- rls policy, so the caller sees exactly the rows their membership allows.
create or replace function public.rpc_search_server_documents(
  p_query text,
  p_embedding extensions.vector,
  p_model_id text,
  p_limit int default 8
)
returns table (
  document_id text,
  title text,
  excerpt text,
  score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with vector_pool as (
    -- ranked by the hnsw index; the inner ORDER BY <=> is what makes the
    -- index applicable, so it stays free of joins and grouping. the pool is
    -- wider than the answer (x4) so a hit ranked poorly by one leg can still
    -- win overall.
    select chunks.document_id, chunks.text, chunks.distance from (
      select c.document_id,
             c.text,
             c.embedding operator(extensions.<=>) p_embedding as distance
      from public.server_document_chunk c
      where c.model_id = p_model_id
      order by c.embedding operator(extensions.<=>) p_embedding
      limit greatest(coalesce(p_limit, 8), 1) * 4
    ) chunks
  ),
  vector_leg as (
    select vp.document_id,
           min(vp.distance) as distance,
           (array_agg(vp.text order by vp.distance))[1] as excerpt,
           row_number() over (order by min(vp.distance)) as rank
    from vector_pool vp
    group by vp.document_id
  ),
  fts_pool as (
    select c.document_id,
           max(ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query))) as rank_score
    from public.server_document_chunk c
    where c.fts @@ websearch_to_tsquery('english', p_query)
    group by c.document_id
    order by max(ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query))) desc
    limit greatest(coalesce(p_limit, 8), 1) * 4
  ),
  fts_leg as (
    select fp.document_id,
           row_number() over (order by fp.rank_score desc) as rank
    from fts_pool fp
  ),
  fused as (
    -- standard reciprocal-rank-fusion damping: 1 / (60 + rank).
    select coalesce(v.document_id, f.document_id) as document_id,
           coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + f.rank), 0) as score,
           v.excerpt
    from vector_leg v
    full outer join fts_leg f using (document_id)
  )
  select fused.document_id,
         coalesce(s.title, '') as title,
         coalesce(
           fused.excerpt,
           (select c2.text
            from public.server_document_chunk c2
            where c2.document_id = fused.document_id
            order by c2.ord
            limit 1),
           ''
         ) as excerpt,
         fused.score::double precision as score
  from fused
  left join public.server_document_index_state s
    on s.document_id = fused.document_id
  order by fused.score desc
  limit greatest(coalesce(p_limit, 8), 1);
$$;

comment on function public.rpc_search_server_documents(text, extensions.vector, text, int) is
  'Hybrid server document search: vector leg (hnsw cosine) + fts leg (gin tsvector), reciprocal-rank fusion. SECURITY INVOKER — rls fences rows; caller supplies the query embedding from the server-pinned model.';

revoke all on function public.rpc_search_server_documents(text, extensions.vector, text, int) from public;
revoke all on function public.rpc_search_server_documents(text, extensions.vector, text, int) from anon;
grant execute on function public.rpc_search_server_documents(text, extensions.vector, text, int) to authenticated;
grant execute on function public.rpc_search_server_documents(text, extensions.vector, text, int) to service_role;
