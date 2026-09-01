import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  debounce,
  throttle,
  useDeferredGate,
  useStickyGate,
} from './debounce';

// vitest's globals are off in this package, so Testing Library's auto-cleanup
// never registers itself — unmount explicitly or renders stack up across tests.
afterEach(cleanup);

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the delay, with the last arguments', () => {
    const fn = vi.fn();
    const scheduled = debounce(fn, 100);
    scheduled('a');
    scheduled('b');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('drops a pending call on clear, and clearing when idle is safe', () => {
    const fn = vi.fn();
    const scheduled = debounce(fn, 100);
    scheduled('a');
    scheduled.clear();
    scheduled.clear();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires on the leading edge and again with the last trailing value', () => {
    const fn = vi.fn();
    const scheduled = throttle(fn, 100);
    scheduled('a');
    scheduled('b');
    scheduled('c');
    expect(fn).toHaveBeenCalledExactlyOnceWith('a');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');
  });

  it('does not fire a trailing call when nothing arrived during cooldown', () => {
    const fn = vi.fn();
    const scheduled = throttle(fn, 100);
    scheduled('a');
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

function Gate({
  hook,
  source,
}: {
  hook: (source: boolean, delay?: number) => boolean;
  source: boolean;
}) {
  return <span data-testid="gate">{hook(source, 100) ? 'open' : 'shut'}</span>;
}

const gate = () => screen.getByTestId('gate').textContent;

describe('useStickyGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens immediately and closes only after the delay', () => {
    const { rerender } = render(<Gate hook={useStickyGate} source={false} />);
    expect(gate()).toBe('shut');

    rerender(<Gate hook={useStickyGate} source={true} />);
    expect(gate()).toBe('open');

    rerender(<Gate hook={useStickyGate} source={false} />);
    expect(gate()).toBe('open');

    act(() => vi.advanceTimersByTime(100));
    expect(gate()).toBe('shut');
  });

  it('stays open across a brief false blip', () => {
    const { rerender } = render(<Gate hook={useStickyGate} source={true} />);
    rerender(<Gate hook={useStickyGate} source={false} />);
    act(() => vi.advanceTimersByTime(50));
    rerender(<Gate hook={useStickyGate} source={true} />);
    act(() => vi.advanceTimersByTime(200));
    expect(gate()).toBe('open');
  });
});

describe('useDeferredGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts shut even when the source is already true', () => {
    render(<Gate hook={useDeferredGate} source={true} />);
    expect(gate()).toBe('shut');
  });

  it('opens after the source stays true for the delay', () => {
    render(<Gate hook={useDeferredGate} source={true} />);
    act(() => vi.advanceTimersByTime(100));
    expect(gate()).toBe('open');
  });

  it('closes immediately when the source goes false', () => {
    const { rerender } = render(<Gate hook={useDeferredGate} source={true} />);
    act(() => vi.advanceTimersByTime(100));
    expect(gate()).toBe('open');

    rerender(<Gate hook={useDeferredGate} source={false} />);
    expect(gate()).toBe('shut');
  });

  it('never opens when the source falls before the delay elapses', () => {
    const { rerender } = render(<Gate hook={useDeferredGate} source={true} />);
    act(() => vi.advanceTimersByTime(50));
    rerender(<Gate hook={useDeferredGate} source={false} />);
    act(() => vi.advanceTimersByTime(500));
    expect(gate()).toBe('shut');
  });
});
