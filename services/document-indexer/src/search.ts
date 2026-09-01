import type { Database } from '@workspace/db';
import type { IEmbeddingService } from '@workspace/domain';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side document search: the same hybrid shape as the local engine
 * (vector leg + fts leg, reciprocal-rank fusion), answered over the server
 * index for consumers that have no local replica — agents and API surfaces.
 *
 * The query is embedded HERE, by the server's pinned model, because a query
 * vector is only comparable to chunk vectors from the same model — and this
 * service is the one place that holds it. The engines never mix vectors: a
 * caller cannot supply one.
 *
 * ACCESS: the RPC is SECURITY INVOKER and every table it touches carries the
 * document-read policy, so the call is made with the CALLER's token and
 * Postgres RLS is the sole fence. The service-role client is deliberately NOT
 * used on this path — it would see every space.
 */

export interface ServerSearchHit {
  documentId: string;
  title: string;
  excerpt: string;
  score: number;
}

export const SEARCH_DEFAULT_LIMIT = 8;
export const SEARCH_MAX_LIMIT = 50;

/** pgvector reads vectors as their text literal. */
const toVectorLiteral = (v: Float32Array): string =>
  `[${Array.from(v).join(',')}]`;

export async function searchServerDocuments(args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** The caller's access token. RLS runs as this user; never service-role. */
  accessToken: string;
  embedder: IEmbeddingService;
  query: string;
  limit?: number;
}): Promise<ServerSearchHit[]> {
  const term = args.query.trim();
  if (!term) return [];

  const [queryVector] = await args.embedder.embed([term], 'query');
  if (!queryVector) {
    throw new Error('query embedding produced no vector');
  }

  const supabase = createClient<Database>(args.supabaseUrl, args.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${args.accessToken}` } },
  });

  const { data, error } = await supabase.rpc('rpc_search_server_documents', {
    p_query: term,
    p_embedding: toVectorLiteral(queryVector),
    p_model_id: args.embedder.modelId,
    p_limit: clampLimit(args.limit),
  });
  if (error) throw new Error(`server search failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    documentId: row.document_id,
    title: row.title,
    excerpt: row.excerpt,
    score: row.score,
  }));
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), SEARCH_MAX_LIMIT);
}
