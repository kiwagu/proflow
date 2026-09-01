import {
  type PushResult,
  type ReconcileDeps,
  runPushPass,
} from './reconcile.js';

/**
 * The background half of media sync: a loop that keeps pushing until it has
 * nothing left to push, then goes quiet until something wakes it.
 *
 * It is a loop rather than a scheduler because reconciliation is level-
 * triggered, not edge-triggered: it acts on the difference it observes, so a
 * missed wake-up costs latency and never correctness — the interval sweep
 * finds the same work later. That is what makes it safe to run in a tab that
 * may be closed at any moment.
 */

/** Idle cadence. Long: the nudge below covers the interactive case, and this
 * is only the backstop for work that arrived while nobody was looking. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Backoff after a pass that had failures, so a network outage does not turn
 * into a tight retry loop against a server that is already unhappy. */
const RETRY_INTERVAL_MS = 60 * 1000;

export type MediaSyncLoop = {
  /** Asks for a pass soon — call after importing files. Never throws. */
  nudge(): void;
  /** Runs a pass now and resolves with its result. For tests and for UI that
   * wants to show progress. */
  passNow(): Promise<PushResult>;
  stop(): void;
};

export type MediaSyncLoopOptions = {
  intervalMs?: number;
  retryIntervalMs?: number;
  /** Injected for tests; defaults to the platform timers. */
  schedule?: (fn: () => void, ms: number) => () => void;
};

function defaultSchedule(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}

export function startMediaSyncLoop(
  deps: ReconcileDeps,
  options?: MediaSyncLoopOptions
): MediaSyncLoop {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const retryMs = options?.retryIntervalMs ?? RETRY_INTERVAL_MS;
  const schedule = options?.schedule ?? defaultSchedule;

  let cancelTimer: (() => void) | undefined;
  let running = false;
  // Set when a nudge arrives mid-pass: the pass in flight may have already
  // read its batch, so the new work needs a pass of its own rather than a
  // second concurrent one.
  let rerun = false;
  let stopped = false;

  async function pass(): Promise<PushResult> {
    running = true;
    try {
      return await runPushPass(deps);
    } finally {
      running = false;
    }
  }

  function arm(ms: number) {
    cancelTimer?.();
    if (stopped) return;
    cancelTimer = schedule(() => void cycle(), ms);
  }

  async function cycle(): Promise<void> {
    if (stopped) return;
    const result = await pass().catch((error: unknown) => {
      deps.log?.(
        `media sync pass failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    });

    if (rerun) {
      rerun = false;
      // Straight back in: something arrived while this pass was reading.
      arm(0);
      return;
    }
    // Drain a backlog at full speed (a pass is capped, so more may remain),
    // back off after failures, otherwise sleep until the next sweep.
    if (result && result.failed > 0) arm(retryMs);
    else if (result && result.uploaded > 0) arm(0);
    else arm(intervalMs);
  }

  arm(0);

  return {
    nudge() {
      if (stopped) return;
      if (running) {
        rerun = true;
        return;
      }
      arm(0);
    },
    passNow: pass,
    stop() {
      stopped = true;
      cancelTimer?.();
      cancelTimer = undefined;
    },
  };
}
