import type { Unsubscribe } from '@workspace/domain';

/**
 * A domain watch: deliver a value now and on every change, until
 * unsubscribed. `watchQuery` produces these from live queries, and the
 * readers' `watchAll`/`watchRecent` methods have the same shape.
 */
export type Watch<T> = (cb: (value: T) => void) => Unsubscribe;

/**
 * A watch turned into a subscribable current value — the external-store
 * shape UI frameworks integrate with (React's `useSyncExternalStore`,
 * or any effect that reads `get` after a change notification).
 */
export interface LiveValue<T> {
  /**
   * Registers a change listener. The underlying watch is attached while at
   * least one listener is registered and released when the last one leaves.
   */
  subscribe(onChange: () => void): Unsubscribe;
  /** The latest delivered value; `initial` until the first delivery. */
  get(): T;
}

/**
 * Bridges a watch into a `LiveValue`.
 *
 * One underlying subscription is shared by every listener, attached lazily
 * on the first `subscribe` and released when the last listener leaves. The
 * cached value survives detachment, so a re-attach renders the last known
 * rows immediately while the fresh delivery is on its way.
 *
 * `get` returns the cached reference unchanged between deliveries — that
 * stability is what lets `useSyncExternalStore` (which compares snapshots
 * by identity) skip re-renders when nothing was delivered.
 */
export function liveValue<T>(watch: Watch<T>, initial: T): LiveValue<T> {
  let value = initial;
  let detach: Unsubscribe | undefined;
  const listeners = new Set<() => void>();

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (listeners.size === 1) {
        detach = watch((next) => {
          value = next;
          for (const listener of [...listeners]) listener();
        });
      }
      let active = true;
      return () => {
        // Idempotent per listener: a double-unsubscribe must not drop a
        // registration that a later subscriber re-added with the same
        // callback.
        if (!active) return;
        active = false;
        listeners.delete(onChange);
        if (listeners.size === 0) {
          detach?.();
          detach = undefined;
        }
      };
    },
    get: () => value,
  };
}
