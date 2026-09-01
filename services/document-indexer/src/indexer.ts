import './prism-global.js';

import type { Database } from '@workspace/db';
import type { IEmbeddingService } from '@workspace/domain';
import type { SupabaseClient } from '@supabase/supabase-js';

import { deriveDocument } from './derive.js';

/**
 * The derive worker: another replica of every document, with read access and
 * no write-back.
 *
 * It tails the canonical byte stream by the same watermark protocol a client
 * uses — snapshot plus the update rows past it — folds each changed document,
 * embeds it, and bulk-replaces that document's rows in the server index. The
 * index is a projection: truncate it and the next pass rebuilds it from
 * nothing, because the plan compares stream position against what the index
 * says it covers, and an absent row covers zero.
 *
 * It never writes to the document tables. The only thing it writes is its own
 * projection, through RPCs that only `service_role` may execute.
 */

/** How many documents are derived per pass before the loop sleeps again. */
const DEFAULT_BATCH_SIZE = 25;
/** How long the loop sleeps between passes when there was nothing to do. */
const DEFAULT_POLL_INTERVAL_MS = 15_000;

export interface IndexerOptions {
  batchSize?: number;
}

interface PlanRow {
  document_id: string;
  space_id: string;
  watermark: number;
}

/**
 * Reads one document's canonical bytes: the folded snapshot plus every update
 * row after the sequence that snapshot covers.
 *
 * The tail is bounded by the watermark the plan reported, not by "everything
 * that exists now" — so a document written DURING the pass keeps its later
 * updates for the next one instead of being recorded as covered by a
 * watermark the index never actually saw.
 */
async function readDocumentBytes(
  supabase: SupabaseClient<Database>,
  documentId: string,
  watermark: number
): Promise<{ snapshot?: Uint8Array | null; updates: Uint8Array[] }> {
  const { data: doc, error: docError } = await supabase
    .from('crdt_documents')
    .select('snapshot, snapshot_seq')
    .eq('id', documentId)
    .maybeSingle();
  if (docError) throw new Error(`read document ${documentId}: ${docError.message}`);
  if (!doc) return { snapshot: null, updates: [] };

  const { data: updates, error: updatesError } = await supabase
    .from('crdt_updates')
    .select('bytes')
    .eq('doc_id', documentId)
    .gt('seq', doc.snapshot_seq)
    .lte('seq', watermark)
    .order('seq', { ascending: true });
  if (updatesError) {
    throw new Error(`read updates ${documentId}: ${updatesError.message}`);
  }

  return {
    snapshot: decodeBytea(doc.snapshot),
    updates: (updates ?? []).flatMap((row) => {
      const bytes = decodeBytea(row.bytes);
      return bytes ? [bytes] : [];
    }),
  };
}

/**
 * `bytea` arrives over the REST channel as a hex-escaped string (`\x…`).
 * Nothing in the stack decodes it for us, and handing the raw string to the
 * CRDT would fail as corrupt bytes rather than as a bad type.
 */
export function decodeBytea(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string') return null;
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  if (hex.length === 0) return new Uint8Array(0);
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** Derives and stores one document. Returns the number of chunks written. */
export async function indexDocument(
  supabase: SupabaseClient<Database>,
  embedder: IEmbeddingService,
  row: PlanRow
): Promise<number> {
  const bytes = await readDocumentBytes(supabase, row.document_id, row.watermark);
  const derived = await deriveDocument(bytes, embedder);

  const { error } = await supabase.rpc('rpc_replace_server_document_chunks', {
    p_document_id: row.document_id,
    p_space_id: row.space_id,
    p_model_id: embedder.modelId,
    p_title: derived.title,
    p_watermark: row.watermark,
    p_chunks: derived.chunks,
  });
  if (error) {
    throw new Error(`index ${row.document_id}: ${error.message}`);
  }

  return derived.chunks.length;
}

/**
 * One pass over the plan.
 *
 * Each document is derived independently and a failure is logged rather than
 * thrown: one poisoned document must not stall the index for every other one.
 * Its watermark simply does not advance, so the next pass retries it.
 */
export async function runIndexPass(
  supabase: SupabaseClient<Database>,
  embedder: IEmbeddingService,
  options: IndexerOptions = {}
): Promise<{ indexed: number; failed: number; pending: number }> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const { data, error } = await supabase.rpc('rpc_list_documents_to_index', {
    p_model_id: embedder.modelId,
  });
  if (error) throw new Error(`index plan: ${error.message}`);

  const plan = (data ?? []) as PlanRow[];
  const batch = plan.slice(0, batchSize);

  let indexed = 0;
  let failed = 0;
  for (const row of batch) {
    try {
      await indexDocument(supabase, embedder, row);
      indexed += 1;
    } catch (e) {
      failed += 1;
      console.error(`[document-indexer] ${row.document_id}: ${String(e)}`);
    }
  }

  return { indexed, failed, pending: Math.max(plan.length - batch.length, 0) };
}

/**
 * The loop. Runs a pass, then sleeps — unless the pass was capped by the
 * batch size, in which case it goes straight round again so a large backlog
 * (a fresh index, a model bump) drains at full speed instead of one batch per
 * poll interval.
 */
export async function runIndexerLoop(
  supabase: SupabaseClient<Database>,
  embedder: IEmbeddingService,
  options: IndexerOptions & {
    pollIntervalMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const { signal } = options;

  while (!signal?.aborted) {
    let pending = 0;
    try {
      const result = await runIndexPass(supabase, embedder, options);
      pending = result.pending;
      if (result.indexed > 0 || result.failed > 0) {
        console.log(
          `[document-indexer] indexed=${result.indexed} failed=${result.failed} pending=${pending}`
        );
      }
    } catch (e) {
      // A transport-level failure (the whole plan query) is worth a full
      // backoff: retrying it immediately would just hammer a database that is
      // already unhappy.
      console.error(`[document-indexer] pass failed: ${String(e)}`);
    }

    if (pending > 0) continue;
    await sleep(pollIntervalMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
