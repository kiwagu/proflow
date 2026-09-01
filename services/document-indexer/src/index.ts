import './prism-global.js';

import { createServerEmbedder } from './embedder.js';
import { runIndexerLoop, runIndexPass } from './indexer.js';
import { startSearchServer } from './search-server.js';
import {
  createServiceRoleSupabaseClient,
  isServiceRoleSupabaseConfigured,
} from './supabase.js';

/**
 * The document indexer service: the derive worker that keeps the server
 * search index converged with the canonical document stream, plus the search
 * endpoint that reads it.
 *
 * They live in one process because they are two halves of one engine — they
 * share the pinned model, and a query embedded by a different model than the
 * chunks would rank meaninglessly. The endpoint is optional (it needs the
 * anon key, since it runs every query under the CALLER's token); without it
 * the process is a pure background worker.
 *
 * `--once` runs a single derive pass and exits — a backfill or a scheduled
 * run. Without it the process stays up and polls.
 */
async function main(): Promise<void> {
  if (!isServiceRoleSupabaseConfigured()) {
    console.error(
      '[document-indexer] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createServiceRoleSupabaseClient();
  const embedder = createServerEmbedder();
  const batchSize = positiveIntFromEnv('DOCUMENT_INDEXER_BATCH_SIZE');
  const pollIntervalMs = positiveIntFromEnv('DOCUMENT_INDEXER_POLL_INTERVAL_MS');

  if (process.argv.includes('--once')) {
    const result = await runIndexPass(supabase, embedder, { batchSize });
    console.log(
      `[document-indexer] once: indexed=${result.indexed} failed=${result.failed} pending=${result.pending}`
    );
    if (result.failed > 0) process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  const search = startSearchIfConfigured(embedder);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`[document-indexer] ${signal} — draining`);
      controller.abort();
      void search?.close();
    });
  }

  console.log(`[document-indexer] started (model ${embedder.modelId})`);
  await runIndexerLoop(supabase, embedder, {
    batchSize,
    pollIntervalMs,
    signal: controller.signal,
  });
  await search?.close();
  console.log('[document-indexer] stopped');
}

function startSearchIfConfigured(
  embedder: ReturnType<typeof createServerEmbedder>
): { close: () => Promise<void> } | null {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      '[document-indexer] SUPABASE_ANON_KEY not set — search endpoint disabled'
    );
    return null;
  }

  const server = startSearchServer({
    embedder,
    supabaseUrl,
    supabaseAnonKey,
    port: positiveIntFromEnv('DOCUMENT_INDEXER_SEARCH_PORT'),
    hostname: process.env.HOST,
  });
  console.log(`[document-indexer] search endpoint on :${server.port}`);
  return server;
}

function positiveIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

await main();
