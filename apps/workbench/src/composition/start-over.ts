import { openBlobStore } from '@workspace/blob-store';
import { deleteLocalDatabaseStorage } from '@workspace/persistence-pglite';
import { readSession, storageNamespace } from './session';

/**
 * Ends everything stored on this device without any service being open —
 * for the screen a failed start-up ends on, where the failure is that the
 * services could not be built.
 *
 * The file store first: it is the half that survives a database that has
 * gone, and the reverse order interrupted leaves bytes nothing can name.
 * Opening the store may itself fail on a device this broken; that must not
 * keep the database from going. A deletion a worker of the failed start
 * still blocks is finished by the next start, before it opens anything of
 * its own.
 */
export async function deleteEverythingAndStartOver(): Promise<void> {
  const session = await readSession();
  if (!session?.spaceId) return;
  const namespace = storageNamespace(session);
  await withTimeout(
    openBlobStore(namespace).then((store) => store.clear()),
    10_000
  ).catch(() => {});
  await deleteLocalDatabaseStorage(namespace).catch(() => {});
  window.location.reload();
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
