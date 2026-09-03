import { createIdbBackend } from './idb.backend.js';
import { createOpfsBackend } from './opfs.backend.js';
import { createPackageStoreOver } from './package.store.js';
import type {
  BlobProgressEvent,
  BlobReady,
  BlobRequest,
  BlobResponse,
} from './protocol.js';
import { createBlobStoreOver } from './store.js';

/**
 * The blob worker. Sync OPFS handles are worker-only, so the store lives
 * here and the page talks to it over messages. Bytes cross as Blob/File
 * references — structured cloning a File does not copy its contents.
 */
const backend = (await createOpfsBackend()) ?? (await createIdbBackend());
const store = createBlobStoreOver(backend);

/**
 * Without persistence the whole origin — these files AND the database —
 * is best-effort and may be evicted under disk pressure. Granted silently
 * in installed/engaged contexts; when denied, the page shows a warning.
 */
const persisted =
  (await navigator.storage?.persist?.().catch(() => false)) ?? false;
const packages = createPackageStoreOver(backend);

self.onmessage = async (event: MessageEvent<BlobRequest>) => {
  const req = event.data;
  let reply: BlobResponse;
  try {
    let result: Extract<BlobResponse, { ok: true }>['result'];
    switch (req.op) {
      case 'put': {
        let last = 0;
        result = await store.put(req.blob, (done, total) => {
          // Throttle to whole percents; a 4 MB chunk already is coarse.
          const pct = Math.floor((done / total) * 100);
          if (pct === last && done !== total) return;
          last = pct;
          self.postMessage({
            type: 'progress',
            id: req.id,
            done,
            total,
          } satisfies BlobProgressEvent);
        });
        break;
      }
      case 'get':
        result = await store.get(req.hash);
        break;
      case 'has':
        result = await store.has(req.hash);
        break;
      case 'delete':
        await store.delete(req.hash);
        result = null;
        break;
      case 'unpack':
        result = await packages.unpack(req.hash, req.archive, (done, total) => {
          self.postMessage({
            type: 'progress',
            id: req.id,
            done,
            total,
          } satisfies BlobProgressEvent);
        });
        break;
      case 'inspect':
        result = await packages.inspect(req.archive);
        break;
      case 'readEntry':
        result = await packages.readEntry(req.hash, req.path);
        break;
      case 'removePackage':
        await packages.remove(req.hash);
        result = null;
        break;
      case 'list':
        result = await store.list();
        break;
      case 'listPackages':
        result = await packages.list();
        break;
      case 'clear':
        await store.clear();
        result = null;
        break;
    }
    reply = { id: req.id, ok: true, result };
  } catch (e) {
    reply = { id: req.id, ok: false, error: String(e) };
  }
  self.postMessage(reply);
};

self.postMessage({
  type: 'ready',
  backend: backend.name,
  persisted,
} satisfies BlobReady);
