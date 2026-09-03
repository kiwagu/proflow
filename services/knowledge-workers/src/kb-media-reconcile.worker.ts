/**
 * KB media reconcile reaper — the scheduled sweep host. Runs
 * `runMediaReconcileSweep` on an interval: heals refcount drift, reaps dead
 * blobs (0 references past the 24 h grace — confirm-failed uploads, abandoned
 * reservations, last-ref purge residue/races) and stray `kb-media` objects with
 * no blob row. This worker is the ONLY sanctioned `service_role` user on the
 * media path (background, off every user request) — all
 * user-facing reads/writes stay under the caller's RLS.
 *
 * Local dev: `bun run dev` in `services/knowledge-workers` starts both workers
 * (concurrently). For this worker only: `bun run start:kb-media-reconcile`.
 * One-shot manual sweep (dev tooling): `bun run kb-media-reconcile:once`,
 * optionally with `--grace-ms=<n>` to override the safety grace (e.g. 0 to
 * reap everything dead RIGHT NOW after a test run).
 *
 * Env (loaded via bun --env-file=.env):
 *   - SUPABASE_URL               (required)
 *   - SUPABASE_SERVICE_ROLE_KEY  (required; the trusted background channel)
 *
 * Runtime: bun, like the other services here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';

import { runMediaReconcileSweep } from './media-reconcile.reap.js';
import {
  createServiceRoleSupabaseClient,
  isServiceRoleSupabaseConfigured,
} from './supabase.js';

/** Sweep cadence — frequent enough that dead bytes never pile up, cheap enough
 * to be invisible (the sweep is a few small reads when there is nothing to do). */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function serviceSupabaseClient(): SupabaseClient<Database> | null {
  if (!isServiceRoleSupabaseConfigured()) {
    return null;
  }
  return createServiceRoleSupabaseClient();
}

function parseGraceMs(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith('--grace-ms='));
  if (!arg) {
    return undefined;
  }
  const value = Number(arg.slice('--grace-ms='.length));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function sweepOnce(
  service: SupabaseClient<Database>,
  graceMs?: number
): Promise<void> {
  try {
    const result = await runMediaReconcileSweep(service, {
      graceMs,
      log: (line) => console.log(`[kb-media-reconcile] ${line}`),
    });
    if (result.healed || result.blobsReaped || result.straysReaped) {
      console.log(
        `[kb-media-reconcile] sweep: healed=${result.healed} blobs=${result.blobsReaped} strays=${result.straysReaped}`
      );
    }
  } catch (error) {
    console.error(
      `[kb-media-reconcile] sweep failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function main(): Promise<void> {
  const service = serviceSupabaseClient();
  if (!service) {
    console.error(
      '[kb-media-reconcile] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — not starting'
    );
    process.exit(1);
  }

  const once = process.argv.includes('--once');
  const graceMs = parseGraceMs(process.argv);

  if (once) {
    await sweepOnce(service, graceMs);
    return;
  }

  console.log(
    `[kb-media-reconcile] started (interval ${SWEEP_INTERVAL_MS / 60000} min)`
  );
  await sweepOnce(service, graceMs);
  setInterval(() => void sweepOnce(service, graceMs), SWEEP_INTERVAL_MS);
}

void main();
