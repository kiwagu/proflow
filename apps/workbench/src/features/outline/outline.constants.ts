import type { Hotkey } from '@workspace/ui/hooks/use-hotkey';

/** The outline panel's width: a heading list needs less than a transcript. */
export const OUTLINE_PANEL_WIDTH = 280;

/**
 * Toggles the outline panel: ⌘⇧O on a mac, Ctrl+Shift+O elsewhere. The
 * registry matches the command modifier either way; the caption is rendered
 * from this same value, so the two cannot drift.
 *
 * O is free to a page on every browser this app targets — the reserved
 * accelerators are the window/tab ones (N, T, W, Tab and their shifted
 * forms), which never reach a document at all.
 */
export const OUTLINE_PANEL_HOTKEY: Hotkey = {
  key: 'o',
  mod: true,
  shift: true,
};
