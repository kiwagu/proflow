/**
 * The app's ONE keyboard-shortcut registry.
 *
 * Every shortcut in the app goes through here, and the module attaches exactly
 * ONE `window` keydown listener no matter how many bindings are live — it is
 * attached when the first binding registers and removed when the last one goes
 * away. A listener per binding would mean N handlers racing on every keystroke
 * with no defined order; one listener with an ordered registry makes
 * precedence a property of the data rather than of attachment timing.
 *
 * Two behaviours are deliberate, because they are where shortcut systems
 * usually break:
 *
 *   - **Typing wins.** A binding does NOT fire while the event comes from an
 *     `input`, a `textarea` or a `contenteditable` host, unless it opted in
 *     with `whileTyping`. Without this, an app shortcut fights the user's
 *     text entry in the editor — the defect this registry exists to prevent.
 *     `whileTyping` is for the dismiss class (Escape), which must reach a
 *     focused field.
 *   - **The newest binding wins.** When two live bindings match the same
 *     keystroke, the one registered LAST handles it and the others do not.
 *     Registration order follows mount order, so "last" means "closest to
 *     what is currently on screen" — an open dialog's binding beats the
 *     background surface's.
 *
 * `preventDefault()` is called only when a binding actually handled the
 * keystroke, so an unclaimed key keeps the browser's own behaviour.
 *
 * Note what this canNOT do: a few accelerators are reserved by the browser and
 * never reach a page at all (Chromium reserves new window / new tab / new
 * incognito / close tab / close window / restore tab / tab switching). Binding
 * one of those produces a shortcut that silently never fires — pick a key the
 * page can actually receive.
 */
import * as React from 'react';

/** A keystroke, matched on `event.key` plus modifiers. */
export type Hotkey = {
  /**
   * The `event.key` value, compared case-insensitively — `'k'`, `'Escape'`.
   * Never a key CODE: `key` is what the user's layout produced.
   */
  key: string;
  /**
   * Requires the platform's command modifier. Matched as `metaKey || ctrlKey`,
   * which covers ⌘ on mac and Ctrl on win/linux without sniffing the platform.
   * Default `false` — the keystroke must then carry NEITHER.
   */
  mod?: boolean;
  /** Requires (or, when `false`, forbids) Shift. Default `false`. */
  shift?: boolean;
  /**
   * Fire even when the keystroke comes from a text field. Default `false`, so
   * a shortcut stays out of the way of typing; opt in for the dismiss class.
   */
  whileTyping?: boolean;
};

type Binding = {
  hotkey: Hotkey;
  handler: (event: KeyboardEvent) => void;
};

/**
 * Live bindings in registration order. Read back-to-front on a keystroke, so
 * the newest match handles it.
 */
const bindings: Binding[] = [];

/** The single window listener, or null while nothing is registered. */
let listening = false;

/** Is the keystroke coming out of somewhere the user is typing? */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function matches(hotkey: Hotkey, event: KeyboardEvent): boolean {
  if ((event.key ?? '').toLowerCase() !== hotkey.key.toLowerCase()) {
    return false;
  }
  if ((event.metaKey || event.ctrlKey) !== (hotkey.mod ?? false)) {
    return false;
  }
  return event.shiftKey === (hotkey.shift ?? false);
}

function onKeyDown(event: KeyboardEvent): void {
  const typing = isTypingTarget(event.target);
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    const binding = bindings[index];
    if (!binding) {
      continue;
    }
    if (typing && !binding.hotkey.whileTyping) {
      continue;
    }
    if (!matches(binding.hotkey, event)) {
      continue;
    }
    // Claimed: suppress the browser's own handling and stop — a keystroke
    // belongs to exactly one binding.
    event.preventDefault();
    binding.handler(event);
    return;
  }
}

function register(binding: Binding): () => void {
  bindings.push(binding);
  if (!listening) {
    listening = true;
    window.addEventListener('keydown', onKeyDown);
  }
  return () => {
    const index = bindings.indexOf(binding);
    if (index !== -1) {
      bindings.splice(index, 1);
    }
    if (bindings.length === 0 && listening) {
      listening = false;
      window.removeEventListener('keydown', onKeyDown);
    }
  };
}

/**
 * Binds a keystroke to an action for as long as the component is mounted.
 *
 *   useHotkey({ key: 'k', mod: true }, () => setOpen((v) => !v));
 *   useHotkey({ key: 'Escape', whileTyping: true }, close, { enabled: open });
 *
 * `enabled: false` unregisters the binding rather than making the handler a
 * no-op, so a disabled shortcut genuinely lets the next match — or the browser
 * — have the keystroke.
 */
export function useHotkey(
  hotkey: Hotkey,
  handler: (event: KeyboardEvent) => void,
  options?: { enabled?: boolean }
): void {
  const enabled = options?.enabled ?? true;

  // The handler is read through a ref so a fresh closure on every render does
  // not re-register the binding — re-registration would silently move it to
  // the end of the queue and change which binding wins.
  const handlerRef = React.useRef(handler);
  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const { key, mod, shift, whileTyping } = hotkey;
  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    return register({
      hotkey: { key, mod, shift, whileTyping },
      handler: (event) => handlerRef.current(event),
    });
  }, [enabled, key, mod, shift, whileTyping]);
}

/** Test seam: how many bindings are live right now. */
export function liveHotkeyCount(): number {
  return bindings.length;
}
