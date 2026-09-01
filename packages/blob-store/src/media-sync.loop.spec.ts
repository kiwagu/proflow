import type { BlobInfo, IBlobStore, IBlobSyncLocal } from '@workspace/domain';
import { describe, expect, it, vi } from 'vitest';
import { startMediaSyncLoop } from './media-sync.loop.js';
import type { ReconcileDeps } from './reconcile.js';

/**
 * A controllable clock: nothing runs until the test advances it, so the loop's
 * scheduling decisions are observable instead of timing-dependent.
 */
function fakeClock() {
  const queued: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  return {
    schedule(fn: () => void, ms: number) {
      const entry = { at: now + ms, fn };
      queued.push(entry);
      return () => {
        const i = queued.indexOf(entry);
        if (i >= 0) queued.splice(i, 1);
      };
    },
    /** Fires everything due at or before `now + ms`, in order. */
    async advance(ms: number) {
      now += ms;
      for (;;) {
        const idx = queued.findIndex((e) => e.at <= now);
        if (idx < 0) break;
        const [entry] = queued.splice(idx, 1);
        entry!.fn();
        // The loop body is async and re-arms itself several awaits deep, so
        // the queue is only settled once the microtask queue is drained.
        for (let i = 0; i < 50; i += 1) await Promise.resolve();
      }
    },
    get pending() {
      return queued.length;
    },
    delays() {
      return queued.map((e) => e.at - now);
    },
  };
}

function depsWith(pending: BlobInfo[][]): {
  deps: ReconcileDeps;
  passes: number;
} {
  let pass = 0;
  const state = { passes: 0 };
  const local: IBlobSyncLocal = {
    async pending() {
      const batch = pending[pass] ?? [];
      pass += 1;
      state.passes = pass;
      return batch.map((info) => ({ ...info, syncState: 'local' as const }));
    },
    async markSynced() {},
    async registerSynced() {},
    async find() {
      return null;
    },
  };
  const store = {
    async get() {
      return new Blob(['x']);
    },
  } as unknown as IBlobStore;
  const remote = {
    async isCertified() {
      return false;
    },
    async putObject() {},
    async certify() {},
    async fetchObject() {
      return null;
    },
  };
  return {
    deps: { store, local, remote },
    get passes() {
      return state.passes;
    },
  };
}

const blob = (n: string): BlobInfo => ({
  hash: n.repeat(64),
  size: 1,
  mime: 'text/plain',
});

describe('media sync loop', () => {
  it('runs a first pass immediately, then sleeps when there is nothing to do', async () => {
    const clock = fakeClock();
    const { deps } = depsWith([[]]);
    const loop = startMediaSyncLoop(deps, {
      intervalMs: 300_000,
      schedule: clock.schedule,
    });

    await clock.advance(0);

    // Idle: the next wake-up is the long backstop sweep, not a busy retry.
    expect(clock.delays()).toEqual([300_000]);
    loop.stop();
  });

  it('keeps going without waiting while a backlog is draining', async () => {
    const clock = fakeClock();
    const tracker = depsWith([[blob('a')], [blob('b')], []]);
    const loop = startMediaSyncLoop(tracker.deps, {
      intervalMs: 300_000,
      schedule: clock.schedule,
    });

    await clock.advance(0);

    // A capped pass that uploaded something means more may remain, so the
    // loop re-arms at zero rather than sleeping through the rest: all three
    // passes ran before the clock moved at all.
    expect(tracker.passes).toBe(3);
    expect(clock.delays()).toEqual([300_000]);
    loop.stop();
  });

  it('backs off after a pass with failures instead of hammering', async () => {
    const clock = fakeClock();
    const { deps } = depsWith([[blob('c')]]);
    const failing: ReconcileDeps = {
      ...deps,
      remote: {
        ...deps.remote,
        async putObject() {
          throw new Error('offline');
        },
      },
    };
    const loop = startMediaSyncLoop(failing, {
      intervalMs: 300_000,
      retryIntervalMs: 60_000,
      schedule: clock.schedule,
    });

    await clock.advance(0);

    expect(clock.delays()).toEqual([60_000]);
    loop.stop();
  });

  it('a nudge asks for a pass now instead of waiting for the sweep', async () => {
    const clock = fakeClock();
    const { deps } = depsWith([[], [], []]);
    const loop = startMediaSyncLoop(deps, {
      intervalMs: 300_000,
      schedule: clock.schedule,
    });
    await clock.advance(0);
    expect(clock.delays()).toEqual([300_000]);

    loop.nudge();

    expect(clock.delays()).toEqual([0]);
    loop.stop();
  });

  it('stop cancels the pending wake-up and ignores later nudges', async () => {
    const clock = fakeClock();
    const { deps } = depsWith([[]]);
    const loop = startMediaSyncLoop(deps, {
      intervalMs: 300_000,
      schedule: clock.schedule,
    });
    await clock.advance(0);

    loop.stop();
    loop.nudge();

    expect(clock.pending).toBe(0);
  });

  it('a pass that throws outright is logged, not propagated', async () => {
    const clock = fakeClock();
    const { deps } = depsWith([[]]);
    const log = vi.fn();
    const loop = startMediaSyncLoop(
      {
        ...deps,
        local: {
          ...deps.local,
          async pending() {
            throw new Error('db closed');
          },
        },
        log,
      },
      { intervalMs: 300_000, schedule: clock.schedule }
    );

    await clock.advance(0);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/db closed/));
    // Still armed: a transient local failure must not kill the loop.
    expect(clock.pending).toBe(1);
    loop.stop();
  });
});
