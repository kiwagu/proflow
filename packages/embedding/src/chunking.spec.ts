import { describe, expect, it } from 'vitest';
import {
  MAX_WINDOWS,
  OVERLAP_CHARS,
  passageWindows,
  WINDOW_CHARS,
} from './chunking.js';

describe('passageWindows', () => {
  it('short text is one window at the start', () => {
    expect(passageWindows('hello world')).toEqual([
      { text: 'hello world', charStart: 0 },
    ]);
  });

  it('empty text embeds nothing', () => {
    expect(passageWindows('   ')).toEqual([]);
  });

  it('covers a long text completely, with overlap', () => {
    const text = 'x'.repeat(WINDOW_CHARS * 3);
    const windows = passageWindows(text);

    // Every character falls inside at least one window.
    const last = windows.at(-1);
    expect(last).toBeDefined();
    expect((last?.charStart ?? 0) + (last?.text.length ?? 0)).toBe(text.length);
    // Consecutive windows overlap, so boundary-straddling sentences are
    // findable from either side.
    expect(windows[1]?.charStart).toBe(WINDOW_CHARS - OVERLAP_CHARS);
  });

  it('caps pathological inputs', () => {
    const text = 'x'.repeat(WINDOW_CHARS * 100);
    expect(passageWindows(text).length).toBe(MAX_WINDOWS);
  });
});
