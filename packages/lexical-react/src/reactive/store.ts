/**
 * @file A minimal keyed store with the accessor/setter shape the ported
 * editor sources were written against.
 *
 * The origin sources use a fine-grained store whose setter accepts either a
 * partial patch (`set({ visible: false })`) or a key/value pair
 * (`set('total', 4)`), and whose read side is a plain object that stays
 * readable from non-component code (plugins run against the raw Lexical
 * editor and have no component around them). React needs the opposite:
 * an immutable snapshot per update so `useSyncExternalStore` can detect a
 * change by identity.
 *
 * This shim keeps the origin call sites intact and swaps the internals: each
 * write shallow-copies the record, so plugin code reads a live accessor while
 * components read a frozen-by-identity snapshot. Only the two setter forms the
 * ported sources actually use are supported — deep paths, `produce` and
 * `reconcile` are deliberately absent rather than half-implemented.
 */
import { useSyncExternalStore } from 'react';
import type { Accessor } from './signal';

export interface SetStoreFunction<T extends object> {
  /** Merge a partial patch into the store. */
  (patch: Partial<T>): void;
  /** Replace one key. Setting `undefined` on a record store deletes the key. */
  <K extends keyof T>(key: K, value: T[K]): void;
}

export interface StoreHandle<T extends object> {
  get: Accessor<T>;
  subscribe(onChange: () => void): () => void;
}

export type Store<T extends object> = T;

/**
 * Creates a store. Returns the origin sources' `[state, setState]` tuple with
 * a third element carrying the subscription handle React components need.
 */
export function createStore<T extends object>(
  initial: T
): [StoreHandle<T>, SetStoreFunction<T>] {
  let value = initial;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const handle: StoreHandle<T> = {
    get: () => value,
    subscribe(onChange) {
      listeners.add(onChange);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(onChange);
      };
    },
  };

  const set = ((...args: unknown[]) => {
    if (args.length === 1) {
      const patch = args[0] as Partial<T>;
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof T>) {
        if (!Object.is(value[key], patch[key])) {
          changed = true;
          break;
        }
      }
      // A patch is a merge, never a replacement: if every key it names already
      // holds that value, nothing can change and subscribers are left alone.
      if (!changed) return;
      value = { ...value, ...patch };
      notify();
      return;
    }

    const [key, next] = args as [keyof T, T[keyof T]];
    if (next === undefined) {
      if (!(key in value)) return;
      const copy = { ...value };
      delete copy[key];
      value = copy;
      notify();
      return;
    }
    if (Object.is(value[key], next)) return;
    value = { ...value, [key]: next };
    notify();
  }) as SetStoreFunction<T>;

  return [handle, set];
}

/** Subscribes a component to a store and returns its latest snapshot. */
export function useStore<T extends object>(store: StoreHandle<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
