/**
 * @file Debouncing, in the shape the ported editor sources use it.
 *
 * The origin sources take their scheduler from a Solid primitives package
 * whose debounced callable also exposes `.clear()` — the editor relies on
 * that (a hover intent cancelled when the pointer leaves, a pending word
 * count dropped when the editor unmounts), so the shape is reproduced rather
 * than replaced with a plain timer.
 *
 * These are deliberately NOT hooks: most callers are plugin code running
 * against the raw Lexical editor with no component around them. Components
 * that need a debounced callback wrap this in `useMemo` and clear it on
 * unmount, exactly as `useDebouncedValue` below does.
 */
import { useEffect, useMemo, useState } from 'react';

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Drop a pending call. Safe to call when nothing is scheduled. */
  clear(): void;
}

/**
 * Trailing-edge debounce: the call fires `delay` ms after the last invocation,
 * with that last invocation's arguments.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduled = ((...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delay);
  }) as Debounced<A>;

  scheduled.clear = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  return scheduled;
}

/**
 * Leading-and-trailing throttle: fires immediately on the first call, skips
 * intermediate calls during the cooldown, then fires once more with the last
 * arguments seen during it.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;

  const scheduled = ((...args: A) => {
    if (timer !== undefined) {
      pending = args;
      return;
    }
    fn(...args);
    timer = setTimeout(function cooldown() {
      timer = undefined;
      if (pending) {
        const trailing = pending;
        pending = undefined;
        scheduled(...trailing);
      }
    }, delay);
  }) as Debounced<A>;

  scheduled.clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  return scheduled;
}

/** A debounced view of a value, for components. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  const schedule = useMemo(
    () => debounce((next: T) => setDebounced(() => next), delay),
    [delay]
  );

  useEffect(() => {
    schedule(value);
  }, [schedule, value]);

  useEffect(() => () => schedule.clear(), [schedule]);

  return debounced;
}

/**
 * A sticky-on-true view of a boolean: rises immediately, falls only after the
 * source has stayed false for `delay` ms. Keeps a menu on screen across the
 * brief false-blip when focus moves between its own controls.
 *
 *     source ______##############__________
 *     result ______###################_____
 *
 * The rising edge is derived during render rather than pushed from an effect —
 * it is a pure function of the source, and only the delayed fall needs a timer.
 */
export function useStickyGate(source: boolean, delay = 300): boolean {
  const [lingering, setLingering] = useState(false);
  const [prevSource, setPrevSource] = useState(source);

  // Render-phase state adjustment: the falling edge is a fact about this
  // render's input, not a side effect, so it is recognised here rather than
  // pushed from an effect a render later.
  if (prevSource !== source) {
    setPrevSource(source);
    if (!source) setLingering(true);
  }

  const down = useMemo(
    () => debounce(() => setLingering(false), delay),
    [delay]
  );

  useEffect(() => {
    if (!lingering) return;
    down();
    return () => down.clear();
  }, [down, lingering]);

  return source || lingering;
}

/**
 * A cold-start lagged gate: always starts false and opens only after the
 * source has been continuously true for `delay` ms. Unmounting before the
 * delay elapses cancels the pending open.
 *
 *     source ##############__________######
 *     result _______#######________________
 *
 * The falling edge is derived during render (a false source is immediately
 * closed); only the delayed open needs a timer.
 */
export function useDeferredGate(source: boolean, delay = 300): boolean {
  const [opened, setOpened] = useState(false);

  const up = useMemo(() => debounce(() => setOpened(true), delay), [delay]);

  useEffect(() => {
    if (!source) {
      up.clear();
      return;
    }
    up();
    return () => up.clear();
  }, [source, up]);

  return source && opened;
}
