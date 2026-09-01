import './prism-global.js';

import { createServerEmbedder } from './embedder.js';
import { runIndexerLoop, runIndexPass } from './indexer.js';
import {
  createServiceRoleSupabaseClient,
  isServiceRoleSupabaseConfigured,
} from './supabase.js';

/**
 * The document indexer service.
 *
 * Keeps the server-side search index converged with the canonical document
 * stream. `--once` runs a single pass and exits (useful for a backfill or a
 * scheduled run); without it the process stays up and polls.
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
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`[document-indexer] ${signal} — draining`);
      controller.abort();
    });
  }

  console.log(`[document-indexer] started (model ${embedder.modelId})`);
  await runIndexerLoop(supabase, embedder, {
    batchSize,
    pollIntervalMs,
    signal: controller.signal,
  });
  console.log('[document-indexer] stopped');
}

function positiveIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

await main();
