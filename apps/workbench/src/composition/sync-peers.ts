/**
 * What the tabs of one browser tell each other about syncing a space, over
 * one BroadcastChannel named after the user and the space:
 *
 *   graph-journal  a graph write went into the shared journal here; the
 *                  leader pushes it (document writes have their own
 *                  announcer, the document store's peers)
 *   visible        this tab is being looked at; the leader keeps the
 *                  visible cadence while such beats are fresh
 *   kick           catch up now: a tab the person just turned to
 *
 * Only hints: whatever the leader does with one, it reads from the shared
 * database or the server. A channel delivers to every other tab, never back
 * to the one that posted.
 */

export type SyncPeerMessage = { type: 'graph-journal' | 'visible' | 'kick' };

export interface SyncPeers {
  announceGraphJournal(): void;
  announceVisible(): void;
  announceKick(): void;
  on(handler: (message: SyncPeerMessage) => void): () => void;
  close(): void;
}

const TYPES = new Set<SyncPeerMessage['type']>([
  'graph-journal',
  'visible',
  'kick',
]);

function isMessage(value: unknown): value is SyncPeerMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    'type' in value &&
    TYPES.has(value.type as SyncPeerMessage['type'])
  );
}

export function createSyncPeers(options: {
  name: string;
  /** Null: no other tab can be told anything. Omitted: a real channel. */
  channel?: BroadcastChannel | null;
}): SyncPeers {
  const channel =
    options.channel === undefined
      ? typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(options.name)
      : options.channel;
  const post = (type: SyncPeerMessage['type']) =>
    channel?.postMessage({ type } satisfies SyncPeerMessage);

  return {
    announceGraphJournal: () => post('graph-journal'),
    announceVisible: () => post('visible'),
    announceKick: () => post('kick'),
    on(handler) {
      if (!channel) return () => undefined;
      const listener = (event: Event) => {
        const data = (event as MessageEvent<unknown>).data;
        if (isMessage(data)) handler({ type: data.type });
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
    close() {
      channel?.close();
    },
  };
}
