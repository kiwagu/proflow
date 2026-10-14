import { describe, expect, it, vi } from 'vitest';
import { createSyncPeers, type SyncPeerMessage } from './sync-peers';
import { fakeChannelBus } from './testing/sync-fakes';

/**
 * The tabs of one browser tell each other three things: a graph write went
 * into the shared journal, a tab is being looked at, and "catch up now".
 */

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function pair() {
  const bus = fakeChannelBus();
  const a = createSyncPeers({ name: 'n', channel: bus.open('n') });
  const b = createSyncPeers({ name: 'n', channel: bus.open('n') });
  const heardByB: SyncPeerMessage[] = [];
  const heardByA: SyncPeerMessage[] = [];
  b.on((message) => heardByB.push(message));
  a.on((message) => heardByA.push(message));
  return { a, b, heardByA, heardByB };
}

describe('the sync peers', () => {
  it('each announcement reaches the other tab as its message, and not the sender', async () => {
    const { a, heardByA, heardByB } = pair();
    a.announceGraphJournal();
    a.announceVisible();
    a.announceKick();
    await settle();
    expect(heardByB).toEqual([
      { type: 'graph-journal' },
      { type: 'visible' },
      { type: 'kick' },
    ]);
    expect(heardByA).toEqual([]);
  });

  it('ignores anything that is not one of its messages', async () => {
    const bus = fakeChannelBus();
    const raw = bus.open('n');
    const peers = createSyncPeers({ name: 'n', channel: bus.open('n') });
    const heard = vi.fn();
    peers.on(heard);
    raw.postMessage('doc_0000000000000001.0000000000');
    raw.postMessage({ type: 'something-else' });
    raw.postMessage(null);
    await settle();
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops hearing once the handler is removed, and stops everything once closed', async () => {
    const { a, b, heardByB } = pair();
    const later = vi.fn();
    const off = b.on(later);
    off();
    a.announceKick();
    await settle();
    expect(later).not.toHaveBeenCalled();
    expect(heardByB).toEqual([{ type: 'kick' }]);
    b.close();
    a.announceKick();
    await settle();
    expect(heardByB).toEqual([{ type: 'kick' }]);
  });

  it('without a channel it announces nothing and hears nothing', () => {
    const peers = createSyncPeers({ name: 'n', channel: null });
    expect(() => {
      peers.announceGraphJournal();
      peers.announceVisible();
      peers.announceKick();
      peers.on(() => undefined)();
      peers.close();
    }).not.toThrow();
  });
});
