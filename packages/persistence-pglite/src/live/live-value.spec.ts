import { describe, expect, it } from 'vitest';
import { liveValue, type Watch } from './live-value.js';

/** A watch we drive by hand, counting attach/detach. */
function manualWatch<T>(initial?: T) {
  let deliver: ((value: T) => void) | undefined;
  let attached = 0;
  let detached = 0;
  const watch: Watch<T> = (cb) => {
    attached += 1;
    deliver = cb;
    if (initial !== undefined) cb(initial);
    return () => {
      detached += 1;
      deliver = undefined;
    };
  };
  return {
    watch,
    push: (value: T) => deliver?.(value),
    counts: () => ({ attached, detached }),
  };
}

describe('liveValue', () => {
  it('returns the initial value before anyone subscribes', () => {
    const { watch } = manualWatch<number>();
    const value = liveValue(watch, 7);
    expect(value.get()).toBe(7);
  });

  it('attaches on first subscribe and delivers the watched value', () => {
    const source = manualWatch<number>(1);
    const value = liveValue(source.watch, 0);
    expect(source.counts().attached).toBe(0);

    let notified = 0;
    const unsubscribe = value.subscribe(() => {
      notified += 1;
    });
    expect(source.counts().attached).toBe(1);
    // The immediate delivery on attach counts as a change.
    expect(notified).toBe(1);
    expect(value.get()).toBe(1);

    source.push(2);
    expect(notified).toBe(2);
    expect(value.get()).toBe(2);
    unsubscribe();
  });

  it('shares one underlying subscription across listeners', () => {
    const source = manualWatch<string>();
    const value = liveValue(source.watch, '');
    const a = value.subscribe(() => {});
    const b = value.subscribe(() => {});
    expect(source.counts().attached).toBe(1);

    a();
    expect(source.counts().detached).toBe(0);
    b();
    expect(source.counts().detached).toBe(1);
  });

  it('keeps the last value after the final unsubscribe', () => {
    const source = manualWatch<number>();
    const value = liveValue(source.watch, 0);
    const unsubscribe = value.subscribe(() => {});
    source.push(42);
    unsubscribe();
    expect(value.get()).toBe(42);
  });

  it('re-attaches for a later subscriber', () => {
    const source = manualWatch<number>();
    const value = liveValue(source.watch, 0);
    value.subscribe(() => {})();
    value.subscribe(() => {})();
    expect(source.counts()).toEqual({ attached: 2, detached: 2 });
  });

  it('tolerates double-unsubscribe without dropping a re-added listener', () => {
    const source = manualWatch<number>();
    const value = liveValue(source.watch, 0);
    let notified = 0;
    const onChange = () => {
      notified += 1;
    };

    const first = value.subscribe(onChange);
    first();
    const second = value.subscribe(onChange);
    // Stale handle from the first registration must be inert now.
    first();

    source.push(5);
    expect(notified).toBe(1);
    expect(value.get()).toBe(5);
    second();
  });

  it('survives a listener unsubscribing during notification', () => {
    const source = manualWatch<number>();
    const value = liveValue(source.watch, 0);
    let secondNotified = 0;
    const first = value.subscribe(() => {
      first();
    });
    value.subscribe(() => {
      secondNotified += 1;
    });
    source.push(1);
    expect(secondNotified).toBe(1);
  });
});
