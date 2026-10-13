/**
 * The one right-hand slot.
 *
 * The shell renders a single companion region, so the assistant and the
 * document's history are alternatives: opening one must CLOSE the other,
 * never stack. Two booleans can both be true; one piece of state cannot —
 * these cases are what pins that down.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAside } from './aside';

describe('the companion slot', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useAside());
    expect(result.current.open).toBeNull();
  });

  it('shows only the panel that was opened last', () => {
    const { result } = renderHook(() => useAside());

    act(() => result.current.toggle('chat'));
    expect(result.current.open).toBe('chat');

    act(() => result.current.toggle('history'));
    expect(result.current.open).toBe('history');
  });

  it('closes the panel when its own toggle is used again', () => {
    const { result } = renderHook(() => useAside());

    act(() => result.current.toggle('history'));
    act(() => result.current.toggle('history'));

    expect(result.current.open).toBeNull();
  });
});
