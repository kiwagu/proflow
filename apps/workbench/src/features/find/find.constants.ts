import type { Hotkey } from '@workspace/ui/hooks/use-hotkey';

/**
 * Opens find & replace over the open document: ⌘F on a mac, Ctrl+F
 * elsewhere. It fires while typing, deliberately — the editor is exactly
 * where the user is when they reach for it, and the browser's page search
 * it displaces cannot see into the document anyway.
 *
 * One binding opens the whole panel, replace field included. ⌘H / Ctrl+H is
 * NOT bound alongside it: the editor already gives that keystroke to
 * highlighting, and on a mac ⌘H hides the application before any page sees
 * it.
 */
export const FIND_HOTKEY: Hotkey = { key: 'f', mod: true, whileTyping: true };
