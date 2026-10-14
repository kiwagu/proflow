import type { Hotkey } from '@workspace/ui/hooks/use-hotkey';

/** The assistant panel's width, matching the explorer's on the other side. */
export const CHAT_PANEL_WIDTH = 360;

/**
 * Toggles the assistant panel: ⌘⇧L on a mac, Ctrl+Shift+L elsewhere. The
 * registry matches the command modifier either way; the caption is rendered
 * from this same value, so the two cannot drift.
 *
 * L is free to a page on every browser this app targets — the reserved
 * accelerators are the window/tab ones (N, T, W, Tab and their shifted
 * forms), which never reach a document at all.
 */
export const CHAT_PANEL_HOTKEY: Hotkey = { key: 'l', mod: true, shift: true };
