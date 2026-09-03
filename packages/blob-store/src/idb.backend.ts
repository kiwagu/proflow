import type { BlobBackend } from './backend.js';

const DB_NAME = 'workbench-blobs';
const STORE = 'blobs';

/**
 * IndexedDB backend, used where sync OPFS handles are unavailable. Blobs are
 * stored as-is — browsers keep them on disk, not copied into the database —
 * but every read returns the whole value, so it is the fallback, not the
 * default.
 */
export function createIdbBackend(): Promise<BlobBackend> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const run = <T>(
        mode: IDBTransactionMode,
        fn: (store: IDBObjectStore) => IDBRequest<T>
      ) =>
        new Promise<T>((res, rej) => {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
      /**
       * Every key with its value — stored bytes and package entries share
       * one object store. Both requests ride ONE transaction, so the keys
       * and the values are of the same moment; a value read separately
       * could belong to a key that is already gone. The blobs come back as
       * handles, not bytes, so asking for all of them costs their sizes.
       */
      const everything = () =>
        new Promise<Array<[IDBValidKey, Blob]>>((res, rej) => {
          const store = db.transaction(STORE, 'readonly').objectStore(STORE);
          const keys = store.getAllKeys();
          const values = store.getAll();
          keys.onerror = () => rej(keys.error);
          values.onerror = () => rej(values.error);
          values.onsuccess = () =>
            res(keys.result.map((key, i) => [key, values.result[i] as Blob]));
        });
      resolve({
        name: 'idb',
        async write(hash, blob) {
          await run('readwrite', (s) => s.put(blob, hash));
        },
        async read(hash) {
          return (
            (await run<Blob | undefined>('readonly', (s) => s.get(hash))) ??
            null
          );
        },
        async size(hash) {
          const blob = await run<Blob | undefined>('readonly', (s) =>
            s.get(hash)
          );
          return blob ? blob.size : null;
        },
        async remove(hash) {
          await run('readwrite', (s) => s.delete(hash));
        },
        async writeEntry(hash, path, data) {
          const blob =
            data instanceof Uint8Array
              ? new Blob([data as BlobPart])
              : await new Response(data).blob();
          await run('readwrite', (s) => s.put(blob, `pkg:${hash}:${path}`));
          return blob.size;
        },
        async readEntry(hash, path) {
          return (
            (await run<Blob | undefined>('readonly', (s) =>
              s.get(`pkg:${hash}:${path}`)
            )) ?? null
          );
        },
        async removePackage(hash) {
          const range = IDBKeyRange.bound(`pkg:${hash}:`, `pkg:${hash}:\uffff`);
          await run('readwrite', (s) => s.delete(range));
        },
        async list() {
          const out: Array<{ hash: string; size: number }> = [];
          for (const [key, blob] of await everything()) {
            if (typeof key === 'string' && !key.startsWith('pkg:'))
              out.push({ hash: key, size: blob.size });
          }
          return out;
        },
        async listPackages() {
          const sizes = new Map<string, number>();
          for (const [key, blob] of await everything()) {
            if (typeof key !== 'string' || !key.startsWith('pkg:')) continue;
            const hash = key.slice(4, key.indexOf(':', 4));
            sizes.set(hash, (sizes.get(hash) ?? 0) + blob.size);
          }
          return [...sizes].map(([hash, size]) => ({ hash, size }));
        },
        async clear() {
          await run('readwrite', (s) => s.clear());
        },
      });
    };
  });
}
