/**
 * Used by the root `build` script: runs `turbo run build` confined to a subset
 * of CPU cores so a full monorepo build never saturates the host.
 *
 * Why: `turbo build` builds several Next.js apps in parallel, and each Next
 * build spawns a worker pool sized to the full core count. Combined, that is
 * far more busy threads than cores → 100% on every core and an unresponsive
 * machine. We reserve a couple of cores for the OS / monitoring by pinning the
 * whole build process-tree with `taskset` (Linux), and we match turbo's task
 * concurrency to the same budget.
 *
 * Cores used = max(1, availableCores - BUILD_RESERVED_CORES). Default reserve is 2.
 *
 * Usage (from repo root):
 *   bun run build                       # capped: all cores minus 2
 *   BUILD_RESERVED_CORES=4 bun run build
 *   BUILD_RESERVED_CORES=0 bun run build # use every core (e.g. CI)
 *   bun run build -- --filter=web        # extra args pass through to turbo
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function availableCores(): number {
  const fn = (os as { availableParallelism?: () => number }).availableParallelism;
  const n = typeof fn === 'function' ? fn() : os.cpus().length;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseReserved(): number {
  const raw = process.env.BUILD_RESERVED_CORES;
  if (raw === undefined || raw.trim() === '') {
    return 2;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

const total = availableCores();
const reserved = parseReserved();
const cores = Math.max(1, total - reserved);
const range = `0-${cores - 1}`;

const passthrough = process.argv.slice(2);
const turboArgs = ['run', 'build', `--concurrency=${cores}`, ...passthrough];

const binDir = path.join(process.cwd(), 'node_modules', '.bin');
const env = {
  ...process.env,
  PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
};

// CPU affinity is the hard guarantee that some cores stay free. taskset is
// Linux-only; elsewhere we still cap turbo concurrency, which is the best we can do.
const canPin = process.platform === 'linux' && cores < total;
const command = canPin ? 'taskset' : 'turbo';
const args = canPin ? ['-c', range, 'turbo', ...turboArgs] : turboArgs;

console.log(
  `[build-capped] ${total} cores detected, reserving ${reserved}, building on ${cores}` +
    (canPin ? ` (pinned to CPUs ${range})` : ' (concurrency cap only)')
);

const result = spawnSync(command, args, {
  stdio: 'inherit',
  cwd: process.cwd(),
  env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
