import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncLeader } from './sync-leader';
import { fakeLocks } from './testing/sync-fakes';

/**
 * One tab per browser holds the lock and runs the network side; the others
 * wait in line for it. A browser without Web Locks gets no leader at all,
 * never one per tab.
 */

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sync leader', () => {
  it('the first tab to ask becomes the leader and starts the network side', async () => {
    const locks = fakeLocks();
    const onAcquire = vi.fn();
    const leader = createSyncLeader({
      name: 'proflow:sync:u:s',
      locks,
      onAcquire,
    });
    await settle();
    expect(onAcquire).toHaveBeenCalledTimes(1);
    expect(leader.isLeader()).toBe(true);
    leader.stop();
  });

  it('a second tab waits while the first one holds the lock', async () => {
    const locks = fakeLocks();
    const first = createSyncLeader({ name: 'n', locks, onAcquire: vi.fn() });
    const onSecond = vi.fn();
    const second = createSyncLeader({ name: 'n', locks, onAcquire: onSecond });
    await settle();
    expect(onSecond).not.toHaveBeenCalled();
    expect(second.isLeader()).toBe(false);
    first.stop();
    second.stop();
  });

  it('stopping releases the lock and runs what the leader started', async () => {
    const locks = fakeLocks();
    const dispose = vi.fn();
    const leader = createSyncLeader({
      name: 'n',
      locks,
      onAcquire: () => dispose,
    });
    await settle();
    leader.stop();
    await settle();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(leader.isLeader()).toBe(false);
    expect(locks.held('n')).toBe(false);
  });

  it('hands over: when the first tab stops, the next one in line takes the lock', async () => {
    const locks = fakeLocks();
    const first = createSyncLeader({ name: 'n', locks, onAcquire: vi.fn() });
    const onSecond = vi.fn();
    const second = createSyncLeader({ name: 'n', locks, onAcquire: onSecond });
    await settle();
    first.stop();
    await settle();
    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(second.isLeader()).toBe(true);
    second.stop();
  });

  it('a tab that stops while waiting never becomes the leader', async () => {
    const locks = fakeLocks();
    const first = createSyncLeader({ name: 'n', locks, onAcquire: vi.fn() });
    const onSecond = vi.fn();
    const second = createSyncLeader({ name: 'n', locks, onAcquire: onSecond });
    await settle();
    second.stop();
    first.stop();
    await settle();
    expect(onSecond).not.toHaveBeenCalled();
    expect(locks.held('n')).toBe(false);
  });

  it('without Web Locks there is no leader, with one warning, and never a tab of its own', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onAcquire = vi.fn();
    const leader = createSyncLeader({ name: 'n', locks: null, onAcquire });
    await settle();
    expect(onAcquire).not.toHaveBeenCalled();
    expect(leader.isLeader()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    leader.stop();
  });
});
