import * as React from 'react';

// Single vs double click on a card (the Google-Drive split): single click opens
// the shared Details panel, double click OPENS the node (folder → navigate in,
// document → read-view). A lone click defers to Details on a short timer so a
// double-click can cancel it — opening never flashes the Details panel first.
// Keyboard Enter on the card button fires a `detail === 0` click, so it lands on
// Details (the safe, reversible action); opening by keyboard is one Enter further,
// from the panel.
//
// Discrimination is on the click's running count (`event.detail`), NOT the separate
// `dblclick` event: the 2nd click of a pair arrives as `detail === 2` and Opens
// directly. Relying on `dblclick` was fragile — the browser drops it whenever a
// re-render swaps the card element between the two clicks (e.g. the reader's
// focus-refetch firing after the editor round-trip), which silently degraded the
// split. There is also no long-lived "armed" flag to wedge: each click cancels and
// reschedules its own pending Details, so the split can never fall back to
// open-on-single-click.
const CARD_DOUBLE_CLICK_MS = 250;

/**
 * useCardOpen — the single-vs-double-click "open" controller for a card button.
 * Generic interaction hook: the caller supplies `onDetails` (single click) and
 * `onOpen` (double click) and spreads the returned `onClick` onto its button.
 */
export function useCardOpen(onDetails: () => void, onOpen: () => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  React.useEffect(() => cancel, [cancel]);
  return {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 1) {
        cancel(); // 2nd click of a pair → Open, drop the pending Details.
        onOpen();
        return;
      }
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        onDetails();
      }, CARD_DOUBLE_CLICK_MS);
    },
  };
}
