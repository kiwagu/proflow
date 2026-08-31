import type {
  BlobInfo,
  IBlobStore,
  IPackageStore,
  PackageEntry,
} from '@workspace/domain';
import type {
  BlobCommand,
  BlobProgressEvent,
  BlobReady,
  BlobResponse,
} from './protocol.js';

/**
 * Page-side client of the blob worker. Resolves once the worker has chosen
 * its backend; a message posted before a module worker finishes evaluating
 * would be lost, so the handshake is not optional.
 */
export type BlobWorkerClient = IBlobStore & {
  backend: BlobReady['backend'];
  /** Whether the browser granted eviction-proof storage for this origin. */
  persisted: boolean;
  packages: IPackageStore;
};

export function createBlobWorkerClient(
  worker: Worker
): Promise<BlobWorkerClient> {
  const pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      onProgress?: (done: number, total: number) => void;
    }
  >();
  let next = 1;

  function call<T>(
    req: BlobCommand,
    onProgress?: (done: number, total: number) => void
  ): Promise<T> {
    const id = next++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      worker.postMessage({ ...req, id });
    });
  }

  return new Promise((resolveReady, rejectReady) => {
    worker.onerror = (e) => rejectReady(new Error(e.message));
    worker.onmessage = (
      event: MessageEvent<BlobResponse | BlobReady | BlobProgressEvent>
    ) => {
      const msg = event.data;
      if ('type' in msg && msg.type === 'progress') {
        pending.get(msg.id)?.onProgress?.(msg.done, msg.total);
        return;
      }
      if ('type' in msg && msg.type === 'ready') {
        resolveReady({
          backend: msg.backend,
          persisted: msg.persisted,
          put: (blob, onProgress) =>
            call<BlobInfo>({ op: 'put', blob }, onProgress),
          get: (hash) => call<Blob | null>({ op: 'get', hash }),
          has: (hash) => call<boolean>({ op: 'has', hash }),
          delete: (hash) => call<null>({ op: 'delete', hash }).then(() => {}),
          list: () =>
            call<Array<{ hash: string; size: number }>>({ op: 'list' }),
          clear: () => call<null>({ op: 'clear' }).then(() => {}),
          packages: {
            unpack: (hash, archive, onProgress) =>
              call<PackageEntry[]>({ op: 'unpack', hash, archive }, onProgress),
            inspect: (archive) =>
              call<PackageEntry[]>({ op: 'inspect', archive }),
            readEntry: (hash, path) =>
              call<Blob | null>({ op: 'readEntry', hash, path }),
            list: () =>
              call<Array<{ hash: string; size: number }>>({
                op: 'listPackages',
              }),
            remove: (hash) =>
              call<null>({ op: 'removePackage', hash }).then(() => {}),
          },
        });
        return;
      }
      const res = msg as BlobResponse;
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else p.reject(new Error(res.error));
    };
  });
}
