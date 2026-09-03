import { useMemo, useSyncExternalStore } from 'react';
import { liveValue, type Watch } from '../live/live-value.js';

/**
 * Subscribes a component to a domain watch (deliver now + on every change,
 * until unsubscribed) and returns its latest value.
 *
 * `watch` must be referentially stable — wrap an inline closure in
 * `useCallback` (or hoist it) — because a new function identity means a new
 * subscription: the old one is released and the value resets to `initial`
 * until the fresh delivery lands.
 */
export function useWatch<T>(watch: Watch<T>, initial: T): T {
  const store = useMemo(() => liveValue(watch, initial), [watch, initial]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
