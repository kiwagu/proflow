import { afterEach, describe, expect, it } from 'vitest';
import { createBroadcastDocumentPeers } from './document.peers.js';

/**
 * The tabs' channel: an announcement reaches every other tab on the same
 * channel and never the tab that made it.
 */
describe('the tabs of one browser', () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });

  it('hear what another tab announces, and not their own', async () => {
    const name = `peers-spec-${Math.random()}`;
    const a = createBroadcastDocumentPeers(name);
    const b = createBroadcastDocumentPeers(name);
    closers.push(a.close, b.close);
    const heardByA: string[] = [];
    const heardByB: string[] = [];
    a.listen((id) => heardByA.push(id));
    b.listen((id) => heardByB.push(id));

    a.announce('doc-1');
    await expect.poll(() => heardByB).toEqual(['doc-1']);
    expect(heardByA).toEqual([]);
  });

  it('stop hearing once they stop listening', async () => {
    const name = `peers-spec-${Math.random()}`;
    const a = createBroadcastDocumentPeers(name);
    const b = createBroadcastDocumentPeers(name);
    closers.push(a.close, b.close);
    const heard: string[] = [];
    const stop = b.listen((id) => heard.push(id));
    stop();
    a.announce('doc-1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heard).toEqual([]);
  });
});
