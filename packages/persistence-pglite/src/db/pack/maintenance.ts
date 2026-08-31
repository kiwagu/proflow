import type { OpfsPackFS } from './opfs-pack.fs.js';

/**
 * How the page reaches the pack store's maintenance from outside the
 * worker. The store lives in whichever context won the leader election —
 * possibly another tab's worker — so the page cannot call it; it asks over
 * a broadcast channel and the leader answers. A request nobody answers in
 * time (no leader yet, or a leader on a build without this) resolves to
 * null, and the caller carries on without the numbers.
 */
const CHANNEL = 'proflow:pack-maintenance';

export interface PackStats {
  /** Bytes the database file occupies. */
  packBytes: number;
  /** Bytes of that which no file uses any more. */
  freeBytes: number;
}

type Request = { id: string; kind: 'stats' } | { id: string; kind: 'compact' };
type Reply =
  | { id: string; kind: 'stats'; stats: PackStats }
  | { id: string; kind: 'compact'; before: number; after: number };

/** Worker side: answers for the store, one request at a time. */
export function servePackMaintenance(
  fs: OpfsPackFS,
  exclusive: <T>(work: () => Promise<T>) => Promise<T>
): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = async (event: MessageEvent<Request>) => {
    const request = event.data;
    if (request.kind === 'stats') {
      const stats = { packBytes: fs.packBytes, freeBytes: fs.freeBytes };
      channel.postMessage({ id: request.id, kind: 'stats', stats } as Reply);
    } else if (request.kind === 'compact') {
      const result = await exclusive(async () => fs.compact());
      channel.postMessage({
        id: request.id,
        kind: 'compact',
        ...result,
      } as Reply);
    }
  };
  return () => channel.close();
}

function ask<K extends Reply['kind']>(
  kind: K,
  timeoutMs: number
): Promise<Extract<Reply, { kind: K }> | null> {
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      channel.close();
      resolve(null);
    }, timeoutMs);
    channel.onmessage = (event: MessageEvent<Reply>) => {
      if (event.data.id !== id || event.data.kind !== kind) return;
      clearTimeout(timer);
      channel.close();
      resolve(event.data as Extract<Reply, { kind: K }>);
    };
    channel.postMessage({ id, kind } as Request);
  });
}

export interface PackMaintenance {
  stats(timeoutMs?: number): Promise<PackStats | null>;
  compact(timeoutMs?: number): Promise<number | null>;
}

/** Page side. */
export const packMaintenance: PackMaintenance = {
  async stats(timeoutMs = 3_000): Promise<PackStats | null> {
    return (await ask('stats', timeoutMs))?.stats ?? null;
  },
  /** Resolves to the bytes given back, or null when nobody answered. */
  async compact(timeoutMs = 60_000): Promise<number | null> {
    const reply = await ask('compact', timeoutMs);
    return reply ? reply.before - reply.after : null;
  },
};
