/**
 * In-memory stand-ins for the two browser primitives the sync composition
 * coordinates tabs with: Web Locks and BroadcastChannel. Each behaves the
 * way the browser documents it for the parts the composition relies on —
 * one holder per lock name with a queue behind it, and a channel that
 * delivers to every OTHER member of the same name, asynchronously.
 */

type Waiter = {
  callback: (lock: Lock | null) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export interface FakeLocks extends LockManager {
  /** Whether a tab holds the lock of this name right now. */
  held(name: string): boolean;
}

export function fakeLocks(): FakeLocks {
  const queues = new Map<string, Waiter[]>();
  const holding = new Set<string>();

  const next = (name: string) => {
    if (holding.has(name)) return;
    const waiter = queues.get(name)?.shift();
    if (!waiter) return;
    holding.add(name);
    Promise.resolve()
      .then(() => waiter.callback({ name, mode: 'exclusive' } as Lock))
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        holding.delete(name);
        next(name);
      });
  };

  const request = (
    name: string,
    optionsOrCallback: LockOptions | ((lock: Lock | null) => unknown),
    maybeCallback?: (lock: Lock | null) => unknown
  ) =>
    new Promise((resolve, reject) => {
      const options =
        typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
      const callback =
        typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : maybeCallback!;
      const waiter: Waiter = { callback, resolve, reject };
      const queue = queues.get(name) ?? [];
      queues.set(name, queue);
      queue.push(waiter);
      options.signal?.addEventListener('abort', () => {
        const index = queue.indexOf(waiter);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(new DOMException('The request was aborted.', 'AbortError'));
      });
      next(name);
    });

  return {
    request,
    query: async () => ({ held: [], pending: [] }),
    held: (name: string) => holding.has(name),
  } as unknown as FakeLocks;
}

/** A set of channels of one name: what one browser's tabs share. */
export function fakeChannelBus() {
  const members = new Set<FakeChannel>();

  class FakeChannel extends EventTarget {
    closed = false;
    constructor(readonly name: string) {
      super();
      members.add(this);
    }
    postMessage(data: unknown) {
      if (this.closed) return;
      for (const member of members) {
        if (member === this || member.closed) continue;
        queueMicrotask(() => {
          if (!member.closed)
            member.dispatchEvent(new MessageEvent('message', { data }));
        });
      }
    }
    close() {
      this.closed = true;
      members.delete(this);
    }
  }

  return {
    /** One tab's end of the channel. */
    open: (name = 'bus') =>
      new FakeChannel(name) as unknown as BroadcastChannel,
  };
}
