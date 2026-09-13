import { afterEach, describe, expect, it, vi } from 'vitest';

import { hotkeyLabel } from './hotkey-label.js';

/**
 * The host's own answer is what ships; every other test pins the rendering with
 * an explicit `mac`, so the probe that READS the platform needs a controllable
 * host rather than the machine the suite happens to run on.
 */
const stubHost = (navigatorLike: { platform?: string; userAgent: string }) => {
  vi.stubGlobal('navigator', navigatorLike);
};

afterEach(() => vi.unstubAllGlobals());

describe('hotkeyLabel', () => {
  it('writes the command modifier as ⌘ on a mac and Ctrl elsewhere', () => {
    expect(hotkeyLabel({ key: 'k', mod: true }, { mac: true })).toBe('⌘K');
    expect(hotkeyLabel({ key: 'k', mod: true }, { mac: false })).toBe('Ctrl+K');
  });

  it('writes shift as ⇧ on a mac and Shift+ elsewhere', () => {
    expect(hotkeyLabel({ key: 'f', shift: true }, { mac: true })).toBe('⇧F');
    expect(hotkeyLabel({ key: 'f', shift: true }, { mac: false })).toBe(
      'Shift+F'
    );
  });

  it('orders the modifiers command-then-shift when both are required', () => {
    expect(
      hotkeyLabel({ key: 'p', mod: true, shift: true }, { mac: true })
    ).toBe('⌘⇧P');
    expect(
      hotkeyLabel({ key: 'p', mod: true, shift: true }, { mac: false })
    ).toBe('Ctrl+Shift+P');
  });

  it('shows a bare keystroke with no modifiers at all', () => {
    expect(hotkeyLabel({ key: 'Escape' }, { mac: true })).toBe('Esc');
    expect(hotkeyLabel({ key: 'Escape' }, { mac: false })).toBe('Esc');
  });

  it('uppercases a single character and keeps named keys readable', () => {
    expect(hotkeyLabel({ key: 'j', mod: true }, { mac: false })).toBe('Ctrl+J');
    expect(hotkeyLabel({ key: 'Enter', mod: true }, { mac: true })).toBe('⌘↵');
    expect(hotkeyLabel({ key: 'Enter', mod: true }, { mac: false })).toBe(
      'Ctrl+Enter'
    );
  });

  it('reads a mac host as ⌘ when the caller names no platform', () => {
    stubHost({
      platform: 'MacIntel',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    expect(hotkeyLabel({ key: 'k', mod: true })).toBe('⌘K');
    expect(hotkeyLabel({ key: 'p', mod: true, shift: true })).toBe('⌘⇧P');
  });

  it('reads a non-mac host as Ctrl when the caller names no platform', () => {
    stubHost({
      platform: 'Win32',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140',
    });
    expect(hotkeyLabel({ key: 'k', mod: true })).toBe('Ctrl+K');
    expect(hotkeyLabel({ key: 'p', mod: true, shift: true })).toBe(
      'Ctrl+Shift+P'
    );
  });

  it('reads a mac host from the user agent when platform is absent', () => {
    // `navigator.platform` is deprecated and some hosts omit it; the probe must
    // not fall back to "not a mac" while the user agent plainly says Macintosh.
    stubHost({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    });
    expect(hotkeyLabel({ key: 'k', mod: true })).toBe('⌘K');
  });
});
