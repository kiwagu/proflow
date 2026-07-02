'use client';

import * as React from 'react';

/**
 * useCommandPalette — owns the open/close state of the command palette and binds the
 * global ⌘K / Ctrl+K shortcut that toggles it (slice-12 Phase 3). Kept tiny + separate
 * from the palette UI so the workbench shell can host the trigger + the overlay without
 * pulling the (heavier) palette body into its own render path until it is open.
 */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ⌘K (mac) / Ctrl+K (win/linux) toggles the palette — the universal command-box
      // shortcut. `metaKey || ctrlKey` covers both without a platform sniff.
      if (
        event.key?.toLowerCase() === 'k' &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen } as const;
}
