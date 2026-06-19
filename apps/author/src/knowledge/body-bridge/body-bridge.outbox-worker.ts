import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import config from '@payload-config';
import { createClient } from '@supabase/supabase-js';
import { createLocalReq, getPayload } from 'payload';

import {
  bodyBridgeEnvelopeSchema,
  reconcileBodyBridge,
} from '@/knowledge/fanout';

/**
 * ASYNC durable consumer for the node↔body bridge (slice-08). This is the SECOND
 * consumer of the universal outbox (slice-01 `…170000`), a MIRROR of the canonical
 * notifications worker `services/notifications/src/outbox-worker.ts` — NOT a
 * JetStream consumer. Body-bridge rows ride pgmq via `channel='operation'`, so the
 * durable mechanics (visibility-timeout, retry-backoff, attempt-count, DLQ via
 * `pgmq.archive`) already exist in `rpc_outbox_claim_jobs` / `_complete_job` /
 * `_retry_job`. This worker only adds the `operation`-channel handler the slice-03
 * fan-out's safety-net row was always waiting for.
 *
 * Cycle (slice-08 §2-§3): claim → validate → reconcile → ack | retry | DLQ.
 *  - claim is NARROWED to `channel='operation'` (notifications claims email/sms/
 *    push; the two workers never race over the same row, §8.1 #3);
 *  - after claim, rows are FILTERED to `operation_key='body-bridge'` — foreign
 *    `operation` rows (none exist today) are released non-terminally for a future
 *    domain consumer, never swallowed (§8.1 #2);
 *  - the payload is zod-validated with `bodyBridgeEnvelopeSchema` BEFORE any action
 *    (slice-03 §10.2 follow-up #1, normative): an invalid envelope ⇒ DLQ
 *    immediately (terminal), `reconcileBodyBridge` is NEVER called (§2b);
 *  - a valid envelope ⇒ `reconcileBodyBridge(envelope.node_id, …)` (REUSE, zero new
 *    reconcile logic, §3): idempotent by node_id, so at-least-once delivery is safe;
 *  - reconcile ok ⇒ complete; thrown ⇒ non-terminal retry (transient Mongo/PG
 *    faults heal on retry; ONLY an invalid envelope is terminal, §8.1 #1).
 *
 * Trust context (§5): this is a TRUSTED BACKEND process, not a user RLS session.
 * Claim/complete/retry run under service-role (the outbox is internal-only); the
 * reconciler receives the service-role `db` — legitimate, because a background
 * process has no calling user to run under, and reconcile's only service-role use
 * (systemic orphan confirmation) was already blessed in slice-03 §2.4. The node
 * stays the authority; no new access is opened.
 *
 * Runtime: executed under tsx (Node), not Bun — importing `@payload-config` pulls
 * Lexical, which trips the upstream Bun ESM circular-import bug (same reason as
 * `identity.jetstream.worker.ts`).
 */

type OutboxJob = {
  id: string;
  channel: string;
  operation_key: string | null;
  payload: unknown;
  claim_token: string;
};

const BODY_BRIDGE_CHANNEL = 'operation' as const;
const BODY_BRIDGE_OPERATION_KEY = 'body-bridge' as const;

const OUTBOX_CONSUMER =
  process.env.BODY_BRIDGE_OUTBOX_CONSUMER?.trim() ||
  `author-body-bridge:${process.pid}`;
const OUTBOX_BATCH_SIZE = Number(
  process.env.BODY_BRIDGE_OUTBOX_BATCH_SIZE ?? '10'
);
const OUTBOX_POLL_INTERVAL_MS = Number(
  process.env.BODY_BRIDGE_OUTBOX_POLL_INTERVAL_MS ?? '1000'
);
const OUTBOX_RETRY_SECONDS = Number(
  process.env.BODY_BRIDGE_OUTBOX_RETRY_SECONDS ?? '60'
);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Service-role Supabase client — trusted backend (§5). Mirrors the fan-out's.
 * Memoized at module scope: the claim/complete/retry loop calls this on every
 * RPC on the hot drain path, and a supabase-js client is a reusable connection
 * factory — building a fresh one per call is pure overhead.
 */
let serviceClient: SupabaseClient<Database> | null = null;

function serviceSupabase(): SupabaseClient<Database> {
  if (serviceClient) {
    return serviceClient;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) {
    throw new Error('body-bridge worker: NEXT_PUBLIC_SUPABASE_URL is not set');
  }
  if (!serviceRole) {
    throw new Error('body-bridge worker: SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  serviceClient = createClient<Database>(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serviceClient;
}

export function isBodyBridgeOutboxConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

async function claimBodyBridgeJobs(): Promise<OutboxJob[]> {
  const service = serviceSupabase();
  const { data, error } = await service.rpc('rpc_outbox_claim_jobs', {
    p_consumer: OUTBOX_CONSUMER,
    p_limit: Math.max(OUTBOX_BATCH_SIZE, 1),
    // Narrow the claim to the operation channel ONLY — never touch the
    // notifications domains (email/sms/push). §8.1 #3.
    p_channels: [BODY_BRIDGE_CHANNEL],
  });

  if (error) {
    throw new Error(`Failed to claim body-bridge jobs: ${error.message}`);
  }

  return Array.isArray(data) ? (data as OutboxJob[]) : [];
}

async function completeJob(job: OutboxJob): Promise<void> {
  const service = serviceSupabase();
  const { data, error } = await service.rpc('rpc_outbox_complete_job', {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });

  if (error) {
    throw new Error(
      `Failed to complete body-bridge job ${job.id}: ${error.message}`
    );
  }

  if (data !== true) {
    throw new Error(`Body-bridge job ${job.id} completion was rejected`);
  }
}

async function retryJob(
  job: OutboxJob,
  reason: string,
  terminal: boolean
): Promise<void> {
  const service = serviceSupabase();
  const { data, error } = await service.rpc('rpc_outbox_retry_job', {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_error: reason,
    p_retry_seconds: Math.max(OUTBOX_RETRY_SECONDS, 1),
    p_terminal: terminal,
  });

  if (error) {
    throw new Error(
      `Failed to release body-bridge job ${job.id}: ${error.message}`
    );
  }

  if (data !== true) {
    throw new Error(`Body-bridge job ${job.id} release was rejected`);
  }
}

/**
 * Process one claimed job. The ONLY new logic the slice adds: filter →
 * envelope-validate → reconcile → map the result onto ack/retry/DLQ. All domain
 * compensation is reused from `reconcileBodyBridge`.
 */
export async function processBodyBridgeJob(job: OutboxJob): Promise<void> {
  // Foreign operation row (none exist today): release non-terminally for a future
  // domain consumer — never swallow another domain. §8.1 #2. reconcile is NOT run.
  if (job.operation_key !== BODY_BRIDGE_OPERATION_KEY) {
    await retryJob(
      job,
      `body-bridge worker does not own operation_key="${job.operation_key ?? 'null'}"`,
      false
    );
    return;
  }

  // Validate the envelope BEFORE any action (slice-03 §10.2 #1, normative). The DB
  // does not validate the jsonb shape; an invalid envelope ⇒ DLQ, reconcile NEVER
  // runs (§2b).
  const parsed = bodyBridgeEnvelopeSchema.safeParse(job.payload);
  if (!parsed.success) {
    await retryJob(
      job,
      `body-bridge envelope validation failed: ${parsed.error.message}`,
      true
    );
    return;
  }

  const service = serviceSupabase();
  const payload = await getPayload({ config });
  // Systemic req: no user identity (overrideAccess is already set inside reconcile).
  const req = await createLocalReq({}, payload);

  try {
    await reconcileBodyBridge(parsed.data.node_id, {
      db: service,
      payload,
      req,
    });
    await completeJob(job);
  } catch (error) {
    // Transient reconcile fault (Mongo/PG) → non-terminal retry; at-least-once is
    // safe because reconcile is idempotent by node_id (§3, §8.1 #1).
    await retryJob(job, errorMessage(error), false);
  }
}

/**
 * Drain the body-bridge outbox once (claim-loop until empty). Exported so the e2e
 * suite can drive it DETERMINISTICALLY instead of waiting on the poll timer —
 * mirrors `drainNotificationsOutboxOnce`.
 */
export async function drainBodyBridgeOutboxOnce(): Promise<void> {
  if (draining) {
    return;
  }

  draining = true;

  try {
    while (true) {
      const jobs = await claimBodyBridgeJobs();
      if (jobs.length === 0) {
        return;
      }

      for (const job of jobs) {
        await processBodyBridgeJob(job);
      }

      if (jobs.length < Math.max(OUTBOX_BATCH_SIZE, 1)) {
        return;
      }
    }
  } finally {
    draining = false;
  }
}

export function startBodyBridgeOutboxWorker(): void {
  if (pollTimer) {
    return;
  }

  if (!isBodyBridgeOutboxConfigured()) {
    console.warn(
      'body-bridge worker: Supabase service-role env missing; outbox worker disabled'
    );
    return;
  }

  pollTimer = setInterval(
    () => {
      void drainBodyBridgeOutboxOnce().catch((error) => {
        console.error('body-bridge worker: outbox drain failed', error);
      });
    },
    Math.max(OUTBOX_POLL_INTERVAL_MS, 250)
  );

  pollTimer.unref?.();

  void drainBodyBridgeOutboxOnce().catch((error) => {
    console.error('body-bridge worker: initial outbox drain failed', error);
  });
}

export function stopBodyBridgeOutboxWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
