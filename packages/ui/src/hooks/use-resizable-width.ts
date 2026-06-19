'use client';

import * as React from 'react';

/**
 * use-resizable-width — a generic drag-to-resize width hook with localStorage
 * persistence. Mechanism-only: it knows nothing about what the panel contains.
 *
 * Returns the current width plus a `startResize` pointer handler the divider
 * binds to `onPointerDown`. The width is clamped to `[min, max]` and persisted
 * under `storageKey` so the user's chosen rail width survives reloads. Pointer
 * capture is used so the drag continues even if the cursor leaves the divider.
 */

export type UseResizableWidthOptions = {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
};

export type UseResizableWidth = {
  width: number;
  resizing: boolean;
  startResize: (event: React.PointerEvent<HTMLElement>) => void;
};

export function useResizableWidth({
  storageKey,
  defaultWidth,
  min,
  max,
}: UseResizableWidthOptions): UseResizableWidth {
  const [width, setWidth] = React.useState(defaultWidth);
  const [resizing, setResizing] = React.useState(false);

  // Hydrate from localStorage AFTER mount (SSR-safe: server renders default).
  React.useEffect(() => {
    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(storageKey)
        : null;
    if (stored) {
      const parsed = Number.parseInt(stored, 10);
      if (Number.isFinite(parsed)) {
        setWidth(Math.min(max, Math.max(min, parsed)));
      }
    }
  }, [storageKey, min, max]);

  const dragState = React.useRef<{ startX: number; startWidth: number } | null>(
    null
  );

  const onMove = React.useCallback(
    (event: PointerEvent) => {
      const state = dragState.current;
      if (!state) {
        return;
      }
      const next = Math.min(
        max,
        Math.max(min, state.startWidth + (event.clientX - state.startX))
      );
      setWidth(next);
    },
    [min, max]
  );

  const onUp = React.useCallback(() => {
    if (!dragState.current) {
      return;
    }
    dragState.current = null;
    setResizing(false);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    setWidth((current) => {
      window.localStorage.setItem(storageKey, String(current));
      return current;
    });
  }, [onMove, storageKey]);

  const startResize = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      dragState.current = { startX: event.clientX, startWidth: width };
      setResizing(true);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width, onMove, onUp]
  );

  React.useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    },
    [onMove, onUp]
  );

  return { width, resizing, startResize };
}
