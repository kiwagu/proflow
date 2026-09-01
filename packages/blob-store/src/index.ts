export { type BlobWorkerClient, createBlobWorkerClient } from './client.js';
export { hashBlob } from './hash.js';
export { confinePath } from './path.js';
export {
  ensureLocal,
  type PushOutcome,
  type PushResult,
  pushBlob,
  type ReconcileDeps,
  runPushPass,
} from './reconcile.js';
export { createBlobStoreOver } from './store.js';

/**
 * Opens the blob store in its worker. Called once, from a composition root.
 */
export async function openBlobStore() {
  const { createBlobWorkerClient } = await import('./client.js');
  return createBlobWorkerClient(
    new Worker(new URL('./blob.worker.ts', import.meta.url), {
      type: 'module',
    })
  );
}
