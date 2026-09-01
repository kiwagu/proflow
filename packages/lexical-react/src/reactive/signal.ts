/**
 * @file Minimal reactive primitives for state that lives outside React.
 *
 * The editor stack was written against fine-grained signals that work the
 * same inside and outside components. React splits those worlds: components
 * re-render from hooks, while plugin code (which runs against the raw
 * Lexical editor, with no component in sight) needs plain subscribable
 * state. This module is the bridge — a tiny external store with the same
 * accessor/setter contract the ported sources expect, plus hooks that let
 * components subscribe to one. The shape intentionally matches the
 * `LiveValue` bridge in @workspace/persistence-pglite: `get` returns a
 * stable reference between updates so `useSyncExternalStore` can skip
 * re-renders by identity.
 */
import { useSyncExternalStore } from 'react';

export type Accessor<T> = () => T;
export type Setter<T> = (next: T | ((prev: T) => T)) => void;

export interface Signal<T> {
  /** Read the current value. Stable reference between updates. */
  get: Accessor<T>;
  /** Replace the value (or update it from the previous one) and notify. */
  set: Setter<T>;
  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

export function createSignal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set: (next) => {
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
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
}

/**
 * A keyed record signal — covers the ported sources' partial-update store
 * usage (`setStore(key, value)`, delete by setting undefined). The record
 * is replaced on every update so snapshots stay immutable for React.
 */
export interface RecordSignal<V> {
  get: Accessor<Record<string, V>>;
  setKey(key: string, value: V | undefined): void;
  replace(next: Record<string, V>): void;
  subscribe(onChange: () => void): () => void;
}

export function createRecordSignal<V>(
  initial: Record<string, V> = {}
): RecordSignal<V> {
  const inner = createSignal<Record<string, V>>(initial);
  return {
    get: inner.get,
    subscribe: inner.subscribe,
    setKey(key, value) {
      const prev = inner.get();
      if (value === undefined) {
        if (!(key in prev)) return;
        const next = { ...prev };
        delete next[key];
        inner.set(next);
      } else {
        if (prev[key] === value) return;
        inner.set({ ...prev, [key]: value });
      }
    },
    replace(next) {
      inner.set(next);
    },
  };
}

/** Subscribes a component to a signal and returns its latest value. */
export function useSignalValue<T>(signal: {
  get: Accessor<T>;
  subscribe(onChange: () => void): () => void;
}): T {
  return useSyncExternalStore(
    (onChange) => signal.subscribe(onChange),
    signal.get,
    signal.get
  );
}
