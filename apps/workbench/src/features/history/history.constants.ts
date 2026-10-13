import type { Hotkey } from '@workspace/ui/hooks/use-hotkey';

/** The history panel's width, matching the assistant's on the same side. */
export const HISTORY_PANEL_WIDTH = 360;

/**
 * Toggles the history panel: ⌘⇧H on a mac, Ctrl+Shift+H elsewhere. The
 * registry matches the command modifier either way; the caption is rendered
 * from this same value, so the two cannot drift.
 *
 * H is free to a page on every browser this app targets — the reserved
 * accelerators are the window/tab ones (N, T, W, Tab and their shifted
 * forms), which never reach a document at all.
 */
export const HISTORY_PANEL_HOTKEY: Hotkey = {
  key: 'h',
  mod: true,
  shift: true,
};
