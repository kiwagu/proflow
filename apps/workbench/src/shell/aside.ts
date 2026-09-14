/**
 * Which companion surface the right-hand slot is showing.
 *
 * The shell has ONE right-hand region, so the assistant and the document's
 * history are alternatives rather than neighbours: opening either closes the
 * other. Keeping that as one piece of state rather than a boolean per panel
 * is what makes the exclusion true by construction — two booleans can both
 * be on, and the layout would then have to decide which wins.
 */
import { useCallback, useMemo, useState } from 'react';

export type AsidePanel = 'chat' | 'history';

export interface AsideState {
  /** The panel on screen, or `null` when the slot is closed. */
  open: AsidePanel | null;
  /** Opens the panel, or closes it when it is already the one showing. */
  toggle: (panel: AsidePanel) => void;
  close: () => void;
}

export function useAside(): AsideState {
  const [open, setOpen] = useState<AsidePanel | null>(null);
  const toggle = useCallback(
    (panel: AsidePanel) =>
      setOpen((current) => (current === panel ? null : panel)),
    []
  );
  const close = useCallback(() => setOpen(null), []);
  return useMemo(() => ({ open, toggle, close }), [open, toggle, close]);
}
