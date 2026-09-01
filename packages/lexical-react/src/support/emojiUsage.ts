/**
 * @file Which emoji this user reaches for, so the picker can rank them.
 *
 * Persisted to localStorage: the ranking is a per-device convenience, not
 * workspace data, and losing it costs the user nothing but a few keystrokes.
 * The table is capped so a heavy user's history cannot grow without bound —
 * the least-used entries (oldest first among equals) are evicted.
 */
import { createSignal } from '../reactive/signal';

type EmojiUsage = Record<string, { count: number; lastUsed: number }>;

const MAX_TRACKED_EMOJIS = 100;
const STORAGE_KEY = 'emojiUsage';

function read(): EmojiUsage {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EmojiUsage) : {};
  } catch {
    // Corrupt or unreadable storage (private mode, quota, hand-edited value)
    // is not worth failing the editor over — start the ranking from scratch.
    return {};
  }
}

function write(value: EmojiUsage): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled: the in-memory ranking still works
    // for this session.
  }
}

const usage = createSignal<EmojiUsage>(read());

usage.subscribe(() => write(usage.get()));

export function recordEmojiUsage(emoji: string): void {
  usage.set((current) => {
    const next: EmojiUsage = {
      ...current,
      [emoji]: {
        count: (current[emoji]?.count ?? 0) + 1,
        lastUsed: Date.now(),
      },
    };
    const keys = Object.keys(next);
    if (keys.length > MAX_TRACKED_EMOJIS) {
      const dropped = keys
        .sort(
          (a, b) =>
            next[a].count - next[b].count || next[a].lastUsed - next[b].lastUsed
        )
        .slice(0, keys.length - MAX_TRACKED_EMOJIS);
      for (const key of dropped) {
        delete next[key];
      }
    }
    return next;
  });
}

export function emojiUsageCount(emoji: string): number {
  return usage.get()[emoji]?.count ?? 0;
}

export function frequentEmojiChars(limit: number): string[] {
  return Object.entries(usage.get())
    .sort(([, a], [, b]) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit)
    .map(([emoji]) => emoji);
}

export function clearEmojiUsage(): void {
  usage.set({});
}

/** Subscribe to ranking changes (the picker re-sorts on them). */
export const subscribeEmojiUsage = usage.subscribe;
