import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

interface Stats {
  completed: number;
  total: number;
}

describe('createStore', () => {
  it('merges a partial patch', () => {
    const [store, set] = createStore<Stats>({ completed: 0, total: 0 });
    set({ completed: 2 });
    expect(store.get()).toEqual({ completed: 2, total: 0 });
  });

  it('sets a single key', () => {
    const [store, set] = createStore<Stats>({ completed: 0, total: 0 });
    set('total', 5);
    expect(store.get()).toEqual({ completed: 0, total: 5 });
  });

  it('replaces the snapshot object on every write', () => {
    const [store, set] = createStore<Stats>({ completed: 0, total: 0 });
    const before = store.get();
    set('total', 5);
    expect(store.get()).not.toBe(before);
    expect(before).toEqual({ completed: 0, total: 0 });
  });

  it('deletes a key when a record entry is set to undefined', () => {
    const [store, set] = createStore<Record<string, number>>({ a: 1, b: 2 });
    set('a', undefined!);
    expect(store.get()).toEqual({ b: 2 });
  });

  it('does not notify when a key write changes nothing', () => {
    const [store, set] = createStore<Stats>({ completed: 1, total: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    set('completed', 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when a patch changes nothing', () => {
    const [store, set] = createStore<Stats>({ completed: 1, total: 2 });
    const listener = vi.fn();
    store.subscribe(listener);
    set({ completed: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies once per changing write', () => {
    const [store, set] = createStore<Stats>({ completed: 0, total: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    set({ completed: 1, total: 3 });
    set('total', 4);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('lets a record write through when it adds a key', () => {
    // The selection-data plugin resets by writing a whole fresh default
    // object; a write that introduces a key must reach subscribers.
    const [store, set] = createStore<Record<string, number>>({ a: 1 });
    const listener = vi.fn();
    store.subscribe(listener);
    set({ a: 1, b: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ a: 1, b: 2 });
  });

  it('stops notifying after unsubscribe', () => {
    const [store, set] = createStore<Stats>({ completed: 0, total: 0 });
    const listener = vi.fn();
    store.subscribe(listener)();
    set('total', 9);
    expect(listener).not.toHaveBeenCalled();
  });
});
