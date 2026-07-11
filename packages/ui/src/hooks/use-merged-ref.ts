import * as React from 'react';

/**
 * useMergedRef — merge two element-ref callbacks onto one element (e.g. dnd-kit's
 * draggable + droppable refs onto a single node). Generic interaction hook.
 */
export function useMergedRef(
  a?: (el: HTMLElement | null) => void,
  b?: (el: HTMLElement | null) => void
) {
  return React.useCallback(
    (el: HTMLElement | null) => {
      a?.(el);
      b?.(el);
    },
    [a, b]
  );
}
