/**
 * Workbench blob reaper — the scheduled sweep host. Runs
 * `runWorkbenchBlobReap` on an interval: reclaims durable bytes nothing
 * references and sweeps objects that never got certified. Like the other
 * reaper here it is a background `service_role` user, off every user request;
 * all user-facing reads and writes stay under the caller's own RLS.
 *
 * Local dev: `bun run start:workbench-blob-reap`. One-shot manual sweep:
 * `bun run workbench-blob-reap:once`, optionally with `--grace-ms=<n>` to
 * override the safety grace (e.g. 0 to reap everything dead right now after a
 * test run).
 *
 * Env (loaded via bun --env-file=.env):
 *   - SUPABASE_URL               (required)
 *   - SUPABASE_SERVICE_ROLE_KEY  (required; the trusted background channel)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';

import { runWorkbenchBlobReap } from './workbench-blob-reap.js';
import {
  createServiceRoleSupabaseClient,
  isServiceRoleSupabaseConfigured,
} from './supabase.js';

/** Sweep cadence — frequent enough that dead bytes never pile up, cheap enough
 * to be invisible (two small reads when there is nothing to do). */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

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
    const result = await runWorkbenchBlobReap(service, {
      graceMs,
      log: (line) => console.log(`[workbench-blob-reap] ${line}`),
      // No reference source is wired yet: the file tree that names blobs is a
      // synced row projection the server does not hold. Until it does, the
      // unreferenced leg stays off (fail-closed) and only orphaned objects are
      // swept — passing a `references` reader here is the whole switch-on.
    });
    if (result.blobsReaped || result.orphansReaped) {
      console.log(
        `[workbench-blob-reap] sweep: blobs=${result.blobsReaped} orphans=${result.orphansReaped}`
      );
    }
  } catch (error) {
    console.error(
      `[workbench-blob-reap] sweep failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function main(): Promise<void> {
  if (!isServiceRoleSupabaseConfigured()) {
    console.error(
      '[workbench-blob-reap] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — not starting'
    );
    process.exit(1);
  }
  const service = createServiceRoleSupabaseClient();

  const once = process.argv.includes('--once');
  const graceMs = parseGraceMs(process.argv);

  if (once) {
    await sweepOnce(service, graceMs);
    return;
  }

  console.log(
    `[workbench-blob-reap] started (interval ${SWEEP_INTERVAL_MS / 60000} min)`
  );
  await sweepOnce(service, graceMs);
  setInterval(() => void sweepOnce(service, graceMs), SWEEP_INTERVAL_MS);
}

void main();
