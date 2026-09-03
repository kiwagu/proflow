import { describe, expect, it, vi } from 'vitest';
import { createRecordSignal, createSignal } from './signal';

describe('createSignal', () => {
  it('reads back what was set', () => {
    const signal = createSignal(1);
    expect(signal.get()).toBe(1);
    signal.set(2);
    expect(signal.get()).toBe(2);
  });

  it('accepts an updater function', () => {
    const signal = createSignal(1);
    signal.set((prev) => prev + 1);
    expect(signal.get()).toBe(2);
  });

  it('notifies subscribers on change', () => {
    const signal = createSignal('a');
    const listener = vi.fn();
    signal.subscribe(listener);
    signal.set('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips notification when the value is unchanged by identity', () => {
    const signal = createSignal('a');
    const listener = vi.fn();
    signal.subscribe(listener);
    signal.set('a');
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe, and unsubscribing twice is safe', () => {
    const signal = createSignal(0);
    const listener = vi.fn();
    const unsubscribe = signal.subscribe(listener);
    unsubscribe();
    unsubscribe();
    signal.set(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a subscriber unsubscribing during notification', () => {
    const signal = createSignal(0);
    const second = vi.fn();
    const unsubscribeFirst = signal.subscribe(() => unsubscribeFirst());
    signal.subscribe(second);
    expect(() => signal.set(1)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('createRecordSignal', () => {
  it('adds, replaces and deletes keys', () => {
    const record = createRecordSignal<number>();
    record.setKey('a', 1);
    expect(record.get()).toEqual({ a: 1 });
    record.setKey('a', 2);
    expect(record.get()).toEqual({ a: 2 });
    record.setKey('a', undefined);
    expect(record.get()).toEqual({});
  });

  it('replaces the record object on every write so snapshots stay immutable', () => {
    const record = createRecordSignal<number>({ a: 1 });
    const before = record.get();
    record.setKey('b', 2);
    expect(record.get()).not.toBe(before);
    expect(before).toEqual({ a: 1 });
  });

  it('does not notify when setting an identical value or deleting a missing key', () => {
    const record = createRecordSignal<number>({ a: 1 });
    const listener = vi.fn();
    record.subscribe(listener);
    record.setKey('a', 1);
    record.setKey('missing', undefined);
    expect(listener).not.toHaveBeenCalled();
  });
});
