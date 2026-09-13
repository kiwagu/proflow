import { describe, expect, it } from 'vitest';

import { hotkeyLabel } from './hotkey-label.js';

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

  it('reads the platform from the host when the caller does not say', () => {
    // No `mac` option: the answer must still be one of the two renderings
    // rather than a throw — the hook-free call site is the app's normal one.
    expect(['⌘K', 'Ctrl+K']).toContain(hotkeyLabel({ key: 'k', mod: true }));
  });
});
