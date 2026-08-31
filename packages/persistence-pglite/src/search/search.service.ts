import type {
  IEmbeddingService,
  ISemanticSearch,
  SearchHit,
} from '@workspace/domain';
import { passageWindows } from '@workspace/embedding';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';

/** pgvector reads vectors as their text literal. */
const toVectorLiteral = (v: Float32Array) => `[${Array.from(v).join(',')}]`;

/**
 * How many candidates each leg contributes before fusion. Wider than the
 * final answer so that a hit ranked poorly by one leg can still win overall.
 */
const POOL_MULTIPLIER = 4;
/** Standard reciprocal-rank-fusion damping: 1 / (K + rank). */
const RRF_K = 60;

/**
 * Search over documents: meaning and words, fused.
 *
 * Two legs, each with its own index. The VECTOR leg ranks chunks by cosine
 * distance (HNSW); the FTS leg ranks documents by web-style term matching
 * (GIN). Reciprocal rank fusion combines them without having to make their
 * scores comparable — only the ranks matter, which is the whole trick.
 */
export function createPgliteSemanticSearch(
  db: AppDb,
  embedder: IEmbeddingService
): ISemanticSearch {
  return {
    async indexDocument(documentId) {
      try {
        const { rows } = await db.query<{ markdown: string }>(
          'select markdown from document_content where document_id = $1',
          [documentId]
        );
        const markdown = rows[0]?.markdown ?? '';
        const windows = passageWindows(markdown);
        const vectors =
          windows.length > 0
            ? await embedder.embed(
                windows.map((w) => w.text),
                'passage'
              )
            : [];

        // One statement replaces the whole index — including chunks from an
        // older model, so the document has exactly one, current,
        // representation. A row-per-chunk loop was a round-trip per window,
        // each awaiting a durable flush, and it monopolized the single
        // connection for seconds right when the user was switching
        // documents.
        const chunks = windows.flatMap((window, i) => {
          const vector = vectors[i];
          return window && vector
            ? [{ ord: i, window, literal: toVectorLiteral(vector) }]
            : [];
        });
        await db.query(
          `with cleared as (
             delete from document_chunk where document_id = $1
           )
           insert into document_chunk
             (id, document_id, ord, char_start, text, embedding, model_id, embedded_at)
           select public.entity_id_generate('chk'), $1, ord, char_start, text, embedding::vector, $2, now()
           from unnest($3::int[], $4::int[], $5::text[], $6::text[])
             as chunk(ord, char_start, text, embedding)`,
          [
            documentId,
            embedder.modelId,
            chunks.map((c) => c.ord),
            chunks.map((c) => c.window.charStart),
            chunks.map((c) => c.window.text),
            chunks.map((c) => c.literal),
          ]
        );
        return ok(undefined);
      } catch (e) {
        return err(`search.indexDocument failed: ${String(e)}`);
      }
    },

    async search(query, opts) {
      try {
        const limit = opts?.limit ?? 8;
        const pool = limit * POOL_MULTIPLIER;
        const [queryVector] = await embedder.embed([query], 'query');
        if (!queryVector) return err('query embedding produced no vector');

        const { rows } = await db.query<SearchHit>(
          `
          with vector_pool as (
            -- Ranked by the HNSW index; the inner ORDER BY <=> is what makes
            -- the index applicable, so it stays free of joins and grouping.
            select document_id, text, distance from (
              select document_id, text, embedding <=> $1::vector as distance
                from document_chunk
               where model_id = $2
               order by embedding <=> $1::vector
               limit $3
            ) chunks
          ),
          vector_leg as (
            select document_id,
                   min(distance) as distance,
                   (array_agg(text order by distance))[1] as excerpt,
                   row_number() over (order by min(distance)) as rank
              from vector_pool
             group by document_id
          ),
          fts_leg as (
            select c.document_id,
                   ts_rank_cd(c.fts, websearch_to_tsquery('english', $4)) as rank_score,
                   row_number() over (
                     order by ts_rank_cd(c.fts, websearch_to_tsquery('english', $4)) desc
                   ) as rank
              from document_content c
             where c.fts @@ websearch_to_tsquery('english', $4)
             limit $3
          ),
          fused as (
            select coalesce(v.document_id, f.document_id) as document_id,
                   coalesce(1.0 / ($5 + v.rank), 0) + coalesce(1.0 / ($5 + f.rank), 0) as score,
                   v.excerpt
              from vector_leg v
              full outer join fts_leg f using (document_id)
          )
          select d.id as "documentId",
                 d.title,
                 coalesce(fused.excerpt, d.preview) as excerpt,
                 fused.score::float8 as score
            from fused
            join document d on d.id = fused.document_id
           where d.deleted_at is null
           order by fused.score desc
           limit $6
          `,
          [
            toVectorLiteral(queryVector),
            embedder.modelId,
            pool,
            query,
            RRF_K,
            limit,
          ]
        );
        return ok(rows);
      } catch (e) {
        return err(`search.search failed: ${String(e)}`);
      }
    },
  };
}

/**
 * Re-indexes documents whose chunks are missing or belong to another model.
 * Called once at startup: a model change invalidates every stored vector,
 * and the index must converge back without anyone asking.
 */
export async function reconcileSearchIndex(
  db: AppDb,
  search: ISemanticSearch,
  modelId: string
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select d.id
       from document d
       join document_content c on c.document_id = d.id
      where d.deleted_at is null
        and not exists (
          select 1 from document_chunk k
           where k.document_id = d.id and k.model_id = $1
        )`,
    [modelId]
  );
  for (const row of rows) {
    const result = await search.indexDocument(row.id);
    if (result.isErr()) console.error(result.error);
  }
}
