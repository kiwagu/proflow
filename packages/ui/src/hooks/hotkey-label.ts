/**
 * How a shortcut is WRITTEN for the user, next to the registry that decides how
 * it is MATCHED.
 *
 * The registry deliberately does not sniff the platform: it matches the command
 * modifier as `metaKey || ctrlKey`, so one binding works on every OS. Display
 * cannot get away with that — a hint reading `⌘K` on Windows or Linux tells the
 * user to press a key their keyboard does not have. So the platform question is
 * answered in exactly ONE place, here, and every hint in the app is rendered
 * from the same `Hotkey` value the binding was registered with. A keystroke and
 * its caption can then not drift apart: there is one description, read twice.
 *
 * Modifier glyphs are NOT translatable text. `⌘`, `⇧` and `Ctrl` read the same
 * in every locale — they name physical keycaps — so they live here and never in
 * a catalog, where they would force a translator to know which platform the
 * reader is on.
 */
import type { Hotkey } from './use-hotkey.js';

/**
 * Keys whose `event.key` name is not what a keycap says. Anything absent is
 * shown as-is (uppercased when it is a single character), so `k` → `K` and
 * `F2` → `F2` need no entry.
 */
const NAMED_KEYS: Record<string, { mac: string; other: string }> = {
  Escape: { mac: 'Esc', other: 'Esc' },
  Enter: { mac: '↵', other: 'Enter' },
  Backspace: { mac: '⌫', other: 'Backspace' },
  Delete: { mac: '⌦', other: 'Delete' },
  Tab: { mac: '⇥', other: 'Tab' },
  ArrowUp: { mac: '↑', other: '↑' },
  ArrowDown: { mac: '↓', other: '↓' },
  ArrowLeft: { mac: '←', other: '←' },
  ArrowRight: { mac: '→', other: '→' },
  ' ': { mac: 'Space', other: 'Space' },
};

/**
 * Is this host a mac? Read at call time rather than cached at import, so a
 * module loaded during a server render cannot freeze the wrong answer into the
 * bundle. `userAgent` backs up the deprecated `platform` probe.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform = navigator.platform ?? '';
  return platform.startsWith('Mac') || navigator.userAgent.includes('Mac');
}

/**
 * Renders a shortcut for display: `⌘⇧K` on a mac, `Ctrl+Shift+K` everywhere
 * else.
 *
 *   <Hint label={labels.search} keys={hotkeyLabel(COMMAND_PALETTE_HOTKEY)} />
 *
 * Pass the SAME `Hotkey` object the binding uses — that is the point of the
 * helper. `mac` is a test seam: it makes the expected rendering assertable
 * without depending on the machine the suite happens to run on.
 */
export function hotkeyLabel(
  hotkey: Hotkey,
  options?: { mac?: boolean }
): string {
  const mac = options?.mac ?? isMacPlatform();

  const named = NAMED_KEYS[hotkey.key];
  const key = named
    ? mac
      ? named.mac
      : named.other
    : hotkey.key.length === 1
      ? hotkey.key.toUpperCase()
      : hotkey.key;

  // Command before shift, matching how both platforms print their own menus.
  const parts: string[] = [];
  if (hotkey.mod) {
    parts.push(mac ? '⌘' : 'Ctrl');
  }
  if (hotkey.shift) {
    parts.push(mac ? '⇧' : 'Shift');
  }
  parts.push(key);

  // Mac keycaps run together (`⌘⇧K`); elsewhere the words need a separator.
  return parts.join(mac ? '' : '+');
}
