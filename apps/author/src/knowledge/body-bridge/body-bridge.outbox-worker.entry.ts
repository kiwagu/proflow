/**
 * Runtime entry for the body-bridge async outbox consumer (slice-08).
 * Local dev: `bun run dev` in `apps/author` starts Next + the JetStream workers +
 * THIS worker (concurrently). For the worker only: `bun run body-bridge:worker`.
 *
 * Requires the author Payload env + Supabase service-role env
 * (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYLOAD_SECRET, MONGO_URL).
 * Tune with BODY_BRIDGE_OUTBOX_CONSUMER / _BATCH_SIZE / _POLL_INTERVAL_MS /
 * _RETRY_SECONDS (all optional, sensible defaults).
 *
 * Runtime: executed under tsx (Node), not the Bun runtime. Importing the worker
 * (which pulls `@payload-config` → `@lexical/react`) trips the upstream Bun ESM
 * circular-import bug (oven-sh/bun#17056), so the worker must run under Node.
 * `bun run body-bridge:worker` still works — bun only acts as the script runner.
 */
import 'dotenv/config';

import {
  startBodyBridgeOutboxWorker,
  stopBodyBridgeOutboxWorker,
} from './body-bridge.outbox-worker';

function main(): void {
  startBodyBridgeOutboxWorker();

  console.log('body-bridge.outbox-worker: polling outbox (channel=operation)');

  const shutdown = () => {
    console.log('body-bridge.outbox-worker: shutting down');
    stopBodyBridgeOutboxWorker();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
