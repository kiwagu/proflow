import { act, render } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { liveHotkeyCount, useHotkey, type Hotkey } from './use-hotkey.js';

/** A component whose only job is to hold one binding for its lifetime. */
function Bound({
  hotkey,
  onFire,
  enabled,
}: {
  hotkey: Hotkey;
  onFire: () => void;
  enabled?: boolean;
}) {
  useHotkey(hotkey, onFire, { enabled });
  return null;
}

function press(
  key: string,
  init: Partial<KeyboardEventInit> & { target?: Element } = {}
): KeyboardEvent {
  const { target, ...rest } = init;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...rest,
  });
  act(() => {
    (target ?? window).dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  expect(liveHotkeyCount()).toBe(0);
});

describe('useHotkey', () => {
  it('attaches ONE window listener however many bindings are live', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const view = render(
        <>
          <Bound hotkey={{ key: 'k', mod: true }} onFire={() => {}} />
          <Bound hotkey={{ key: 'n', mod: true }} onFire={() => {}} />
          <Bound hotkey={{ key: 'Escape' }} onFire={() => {}} />
        </>
      );

      const keydownAdds = add.mock.calls.filter(([type]) => type === 'keydown');
      expect(keydownAdds).toHaveLength(1);
      expect(liveHotkeyCount()).toBe(3);

      // …and the listener only comes off once the LAST binding goes.
      view.unmount();
      const keydownRemoves = remove.mock.calls.filter(
        ([type]) => type === 'keydown'
      );
      expect(keydownRemoves).toHaveLength(1);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('fires on the command modifier from either platform', () => {
    const onFire = vi.fn();
    const view = render(
      <Bound hotkey={{ key: 'k', mod: true }} onFire={onFire} />
    );

    press('k', { metaKey: true });
    press('k', { ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(2);

    // The bare key is NOT the shortcut.
    press('k');
    expect(onFire).toHaveBeenCalledTimes(2);

    view.unmount();
  });

  it('preventDefault()s only the keystrokes a binding claimed', () => {
    const view = render(
      <Bound hotkey={{ key: 'k', mod: true }} onFire={() => {}} />
    );

    expect(press('k', { metaKey: true }).defaultPrevented).toBe(true);
    expect(press('p', { metaKey: true }).defaultPrevented).toBe(false);

    view.unmount();
  });

  it('does not fire while the user is typing, unless it opted in', () => {
    const shortcut = vi.fn();
    const dismiss = vi.fn();
    const view = render(
      <>
        <Bound hotkey={{ key: 'k', mod: true }} onFire={shortcut} />
        <Bound hotkey={{ key: 'Escape', whileTyping: true }} onFire={dismiss} />
        <input data-testid="field" />
        <textarea data-testid="area" />
        <div contentEditable data-testid="editable" />
      </>
    );

    for (const testId of ['field', 'area', 'editable']) {
      const target = view.getByTestId(testId);
      if (testId === 'editable') {
        // jsdom does not derive isContentEditable from the attribute.
        Object.defineProperty(target, 'isContentEditable', { value: true });
      }
      press('k', { metaKey: true, target });
      press('Escape', { target });
    }

    expect(shortcut).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(3);

    // Outside a field the same shortcut works.
    press('k', { metaKey: true });
    expect(shortcut).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it('gives a contested keystroke to the binding registered LAST', () => {
    const earlier = vi.fn();
    const later = vi.fn();
    const view = render(
      <>
        <Bound hotkey={{ key: 'k', mod: true }} onFire={earlier} />
        <Bound hotkey={{ key: 'k', mod: true }} onFire={later} />
      </>
    );

    press('k', { metaKey: true });
    expect(later).toHaveBeenCalledTimes(1);
    expect(earlier).not.toHaveBeenCalled();

    view.unmount();
  });

  it('falls back to the earlier binding once the later one unmounts', () => {
    const earlier = vi.fn();
    const later = vi.fn();
    function Pair({ withLater }: { withLater: boolean }) {
      return (
        <>
          <Bound hotkey={{ key: 'k', mod: true }} onFire={earlier} />
          {withLater ? (
            <Bound hotkey={{ key: 'k', mod: true }} onFire={later} />
          ) : null}
        </>
      );
    }

    const view = render(<Pair withLater />);
    press('k', { metaKey: true });
    expect(later).toHaveBeenCalledTimes(1);

    view.rerender(<Pair withLater={false} />);
    expect(liveHotkeyCount()).toBe(1);
    press('k', { metaKey: true });
    expect(earlier).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it('unregisters on unmount — no leaked binding and no leaked listener', () => {
    const onFire = vi.fn();
    const view = render(
      <Bound hotkey={{ key: 'k', mod: true }} onFire={onFire} />
    );
    view.unmount();

    expect(liveHotkeyCount()).toBe(0);
    press('k', { metaKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('unregisters a disabled binding rather than swallowing its keystroke', () => {
    const background = vi.fn();
    const disabled = vi.fn();
    const view = render(
      <>
        <Bound hotkey={{ key: 'Escape' }} onFire={background} />
        <Bound hotkey={{ key: 'Escape' }} onFire={disabled} enabled={false} />
      </>
    );

    expect(liveHotkeyCount()).toBe(1);
    press('Escape');
    expect(disabled).not.toHaveBeenCalled();
    expect(background).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it('keeps its place in the queue when the handler identity changes', () => {
    const earlier = vi.fn();
    const later = vi.fn();
    function Pair({ tick }: { tick: number }) {
      return (
        <>
          <Bound
            hotkey={{ key: 'k', mod: true }}
            onFire={() => earlier(tick)}
          />
          <Bound hotkey={{ key: 'k', mod: true }} onFire={() => later(tick)} />
        </>
      );
    }

    const view = render(<Pair tick={1} />);
    // A re-render hands both bindings brand-new closures. If that
    // re-registered them, the order would flip on every render.
    view.rerender(<Pair tick={2} />);

    press('k', { metaKey: true });
    expect(later).toHaveBeenCalledWith(2);
    expect(earlier).not.toHaveBeenCalled();
    expect(liveHotkeyCount()).toBe(2);

    view.unmount();
  });

  it('distinguishes Shift from its absence', () => {
    const plain = vi.fn();
    const shifted = vi.fn();
    const view = render(
      <>
        <Bound hotkey={{ key: 'n', mod: true }} onFire={plain} />
        <Bound hotkey={{ key: 'n', mod: true, shift: true }} onFire={shifted} />
      </>
    );

    press('n', { metaKey: true });
    expect(plain).toHaveBeenCalledTimes(1);
    expect(shifted).not.toHaveBeenCalled();

    press('N', { metaKey: true, shiftKey: true });
    expect(shifted).toHaveBeenCalledTimes(1);
    expect(plain).toHaveBeenCalledTimes(1);

    view.unmount();
  });
});
