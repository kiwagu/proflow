/**
 * One tab per browser runs the network side of a space.
 *
 * Every tab of one browser shares the local database; only the tab holding
 * the Web Lock named after the user and the space builds a client, runs the
 * engines and keeps the channels open. The others read the shared database
 * and hand their writes to the leader. The lock passes to the next tab in
 * line when the holder closes, with no messages of our own: the browser
 * releases it with the page.
 *
 * A browser without Web Locks gets no leader at all — no sync rather than
 * one set of engines per tab, which would multiply every cost this exists
 * to divide.
 */

export interface SyncLeader {
  /** Leaves the line, or lets go of the lock and undoes what it started. */
  stop(): void;
  isLeader(): boolean;
}

export function createSyncLeader(options: {
  name: string;
  locks?: LockManager | null;
  /** Runs while the lock is held; what it returns runs when it is let go. */
  onAcquire(): void | (() => void);
}): SyncLeader {
  const locks =
    options.locks === undefined
      ? (globalThis.navigator?.locks ?? null)
      : options.locks;
  let leader = false;
  let stopped = false;
  let release: (() => void) | null = null;
  const abort = new AbortController();

  if (!locks) {
    console.warn(
      'this browser has no Web Locks: the workbench will not sync from here'
    );
    return { stop() {}, isLeader: () => false };
  }

  locks
    .request(
      options.name,
      { mode: 'exclusive', signal: abort.signal },
      async () => {
        if (stopped) return;
        leader = true;
        const dispose = options.onAcquire();
        // Held until stop() resolves it, or until the page goes away.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        leader = false;
        if (typeof dispose === 'function') dispose();
      }
    )
    .catch((error: unknown) => {
      // Leaving the line before the lock came is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('the sync leader lock failed', error);
    });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      release?.();
    },
    isLeader: () => leader,
  };
}
