import {
  canonicalEntityIdSchemaFor,
  type DocumentId,
} from '@workspace/entity-id';

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
 *   settled        the leader's first pull of a document known only from
 *                  the graph ended, with a body or without one; a pane
 *                  waiting for it in another tab looks again
 *
 * Only hints: whatever a tab does with one, it reads from the shared
 * database or the server. A channel delivers to every other tab, never back
 * to the one that posted.
 */

export type SyncPeerMessage =
  | { type: 'graph-journal' | 'visible' | 'kick' }
  | { type: 'settled'; id: DocumentId };

export interface SyncPeers {
  announceGraphJournal(): void;
  announceVisible(): void;
  announceKick(): void;
  announceSettled(id: DocumentId): void;
  on(handler: (message: SyncPeerMessage) => void): () => void;
  close(): void;
}

const SIGNALS = new Set(['graph-journal', 'visible', 'kick']);

/** The message as it was posted, or null for anything that is not one. */
function parseMessage(value: unknown): SyncPeerMessage | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  if (typeof value.type === 'string' && SIGNALS.has(value.type))
    return { type: value.type as 'graph-journal' | 'visible' | 'kick' };
  if (value.type === 'settled' && 'id' in value) {
    const id = canonicalEntityIdSchemaFor('document').safeParse(value.id);
    return id.success ? { type: 'settled', id: id.data } : null;
  }
  return null;
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
  const post = (message: SyncPeerMessage) => channel?.postMessage(message);

  return {
    announceGraphJournal: () => post({ type: 'graph-journal' }),
    announceVisible: () => post({ type: 'visible' }),
    announceKick: () => post({ type: 'kick' }),
    announceSettled: (id) => post({ type: 'settled', id }),
    on(handler) {
      if (!channel) return () => undefined;
      const listener = (event: Event) => {
        const message = parseMessage((event as MessageEvent<unknown>).data);
        if (message) handler(message);
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
    close() {
      channel?.close();
    },
  };
}
