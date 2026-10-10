import type { DocumentPeers } from './document.crdt-store.js';

/**
 * The other tabs of this browser, over a broadcast channel: every tab of
 * the origin on the same channel hears an announcement, the announcing one
 * does not. Tabs of different accounts may share the channel — a document
 * id another tab's database does not hold merges nothing there.
 */
export function createBroadcastDocumentPeers(
  name = 'proflow-document-journal'
): DocumentPeers & { close(): void } {
  const channel = new BroadcastChannel(name);
  // A process with nothing else to do must be able to exit (tests, workers).
  (channel as unknown as { unref?: () => void }).unref?.();
  return {
    announce(id) {
      channel.postMessage(id);
    },
    listen(onAnnounce) {
      const listener = (event: MessageEvent<unknown>) => {
        if (typeof event.data === 'string') onAnnounce(event.data);
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
    close() {
      channel.close();
    },
  };
}
