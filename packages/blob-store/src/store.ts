import type { BlobInfo, IBlobStore } from '@workspace/domain';
import { type BlobBackend, infoOf } from './backend.js';
import { hashBlob } from './hash.js';

/**
 * Refuses a write that cannot fit before any byte is processed: running
 * into the quota midway costs minutes on a large file and leaves debris.
 * The margin keeps headroom for the database living in the same origin.
 */
const QUOTA_MARGIN = 256 * 1024 * 1024;

/** Exported for tests; callers go through `put`. */
export async function ensureRoom(size: number): Promise<void> {
  const estimate = await globalThis.navigator?.storage
    ?.estimate?.()
    .catch(() => undefined);
  if (!estimate?.quota) return;
  const free = estimate.quota - (estimate.usage ?? 0);
  if (size + QUOTA_MARGIN <= free) return;
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
  throw new Error(
    `Not enough storage: the file needs ${gb(size)} GB but only ${gb(free)} GB of browser storage is available`
  );
}

/**
 * Content-addressed store over a backend. Two passes over the input — hash,
 * then write under the hash — keep it portable: no backend offers an atomic
 * rename everywhere, and a file named by its own hash is verifiable by size.
 */
export function createBlobStoreOver(backend: BlobBackend): IBlobStore {
  const locks = globalThis.navigator?.locks;
  const exclusive = <T>(hash: string, fn: () => Promise<T>) =>
    locks ? locks.request(`workbench-blob:${hash}`, fn) : fn();

  return {
    async put(blob, onProgress): Promise<BlobInfo> {
      await ensureRoom(blob.size);
      // Two passes: the hash is the first half of the work, the write the
      // second. Progress counts both so the bar does not reset midway.
      const total = blob.size * 2;
      const hash = await hashBlob(blob, (done) => onProgress?.(done, total));
      await exclusive(hash, async () => {
        // Same content already stored and complete: nothing to write.
        if ((await backend.size(hash)) === blob.size) return;
        try {
          await backend.write(hash, blob, (done) =>
            onProgress?.(blob.size + done, total)
          );
        } catch (e) {
          // A partial file under the final name would make `has` lie.
          await backend.remove(hash).catch(() => {});
          throw e;
        }
      });
      onProgress?.(total, total);
      return infoOf(hash, blob);
    },
    get: (hash) => backend.read(hash),
    list: () => backend.list(),
    clear: () => backend.clear(),
    has: async (hash) => (await backend.size(hash)) !== null,
    delete: (hash) => exclusive(hash, () => backend.remove(hash)),
  };
}
