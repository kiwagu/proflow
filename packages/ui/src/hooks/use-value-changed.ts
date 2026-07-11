import * as React from 'react';

/**
 * Returns `true` on the render where `value` differs from the previous render's value —
 * the React-sanctioned "adjust state during render" prev-compare (react.dev "You Might Not
 * Need an Effect"). Call it UNCONDITIONALLY (rules of hooks) and gate your reset on the
 * boolean; the hook owns the prev-value bookkeeping so call sites don't repeat it.
 *
 *   const changed = useValueChanged(prop);
 *   if (changed) { setDraft(prop); ... }   // or `if (changed && open) {...}` for a transition
 *
 * Pass `isEqual` for compound values (e.g. a `{ value, nodeId }` pair) to keep behaviour
 * identical to a hand-rolled composite compare.
 */
export function useValueChanged<T>(
  value: T,
  isEqual: (a: T, b: T) => boolean = Object.is
): boolean {
  const [prev, setPrev] = React.useState(value);
  if (!isEqual(prev, value)) {
    setPrev(value);
    return true;
  }
  return false;
}
