'use client';

import * as React from 'react';

import type {
  DriveMultiSelect,
  DriveScope,
} from '../views/registry/projection-view.types';

/**
 * Multi-select for the Drive workbench (release-hardening B2) — the DISTINCT
 * bulk-selection model powering the floating bulk action bar + Empty Trash. It is
 * SEPARATE from `useDriveSelection` (the single active node for the Details drawer):
 * a checkbox toggles membership here and must NOT open Details, while a card-body
 * single-click still opens Details (unchanged). The public shape is `DriveMultiSelect`
 * (the view contract).
 *
 * State is a `Set<string>` of node ids + a shift-click ANCHOR (the last plainly
 * toggled id). `toggleRange` selects the contiguous run between the anchor and the
 * clicked id over the CURRENT ORDERED VISIBLE id list the view threads in (so a range
 * follows exactly what the user sees, in visual order).
 *
 * FORCED-CLEAR on a lens/folder change — a selection must never leak across lenses.
 * Done the workbench's no-setState-in-effect way: a derived reset key (scope + folder)
 * is compared during render and the set is cleared inline when it changes (React's
 * "adjust state while rendering" pattern), mirroring how the view resets tagFacet /
 * shareFacet on scope change — never a `useEffect` cascade.
 */
export function useDriveMultiSelect({
  scope,
  folderId,
}: {
  scope: DriveScope;
  folderId: string | null;
}): DriveMultiSelect {
  // The reset identity: a selection is scoped to ONE lens location. Leaving the lens
  // or the folder drops it (a stale selection must never act on the next lens).
  const resetKey = `${scope}::${folderId ?? ''}`;
  const [prevResetKey, setPrevResetKey] = React.useState(resetKey);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  // The last plainly toggled id — the shift-range anchor. STATE (not a ref), so the
  // reset can clear it with a plain setState during render (the same "adjust state while
  // rendering" path as the set) without touching a ref mid-render.
  const [anchor, setAnchor] = React.useState<string | null>(null);

  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setSelected(new Set());
    setAnchor(null);
  }

  const toggle = React.useCallback((id: string) => {
    setAnchor(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleRange = React.useCallback(
    (id: string, orderedVisibleIds: readonly string[]) => {
      setAnchor(id);
      setSelected((prev) => {
        const next = new Set(prev);
        // No anchor yet (first click was a shift-click) → behave as a plain add.
        if (anchor == null) {
          next.add(id);
          return next;
        }
        const from = orderedVisibleIds.indexOf(anchor);
        const to = orderedVisibleIds.indexOf(id);
        // Either endpoint no longer visible → degrade to a plain add (never crash).
        if (from === -1 || to === -1) {
          next.add(id);
          return next;
        }
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        for (let i = lo; i <= hi; i += 1) {
          next.add(orderedVisibleIds[i]!);
        }
        return next;
      });
    },
    [anchor]
  );

  const selectAll = React.useCallback((ids: readonly string[]) => {
    setSelected(new Set(ids));
    setAnchor(ids.length > 0 ? ids[ids.length - 1]! : null);
  }, []);

  const clear = React.useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  const isSelected = React.useCallback(
    (id: string) => selected.has(id),
    [selected]
  );

  return {
    selectedIds: selected,
    count: selected.size,
    isSelected,
    toggle,
    toggleRange,
    selectAll,
    clear,
  };
}
