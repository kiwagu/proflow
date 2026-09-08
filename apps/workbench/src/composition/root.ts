import { openBlobStore } from '@workspace/blob-store';
import {
  createOptimisticEntities,
  createOptimisticFiles,
} from '@workspace/domain';
import { PACKAGE_KINDS } from '@workspace/package-kinds';
import {
  createDocumentCrdtStore,
  createPgliteDocumentListReader,
  createPgliteDocumentRepository,
  createPgliteDocumentVersionStore,
  createPgliteFileRepository,
  createPgliteFileTreeReader,
  createPgliteGraphReader,
  createPgliteGraphRepository,
  createPglitePackageReader,
  createPglitePackageRepository,
  createPgliteSettingsStore,
  type OpenStage,
  openLocalDatabase,
} from '@workspace/persistence-pglite';
import { storageNamespace, type WorkbenchSession } from './session';
import type { AppServices } from './services';

/**
 * Composition root — the only module in the app allowed to import adapter
 * packages. Called once, from main.tsx, before the first render.
 *
 * The local database opens through its worker with the store's own pool
 * configuration; nothing here tunes it. Boot is the one moment the pool is
 * fully drawn on (initdb, migrations), and a smaller pool wedges the open.
 */

/**
 * Boot steps still waiting. A start-up that never finishes is otherwise
 * indistinguishable from any other, so the failure screen asks what is
 * still pending and names it.
 */
const pending = new Set<string>();

export function pendingBootSteps(): string[] {
  return [...pending];
}

function step<T>(
  name: string,
  work: Promise<T>,
  also: string[] = []
): Promise<T> {
  pending.add(name);
  return work.finally(() => {
    pending.delete(name);
    for (const other of also) pending.delete(other);
  });
}

const DB_STAGE_NAMES: Record<OpenStage, string> = {
  worker: 'the database worker',
  migration: 'the database schema',
  held: 'another tab to let go of the database',
};

export async function createAppServices(
  reportError: (message: string) => void,
  session: WorkbenchSession
): Promise<AppServices> {
  const namespace = storageNamespace(session);
  if (!session.spaceId) throw new Error('No active space');
  // The database and the blob store open side by side: bytes live in the
  // file system, their identity and place in the tree live in the database.
  const [db, blobs] = await Promise.all([
    step(
      'the local database',
      openLocalDatabase((stage) => {
        // One entry at a time: the step is the same wait, further along.
        pending.delete('the local database');
        for (const name of Object.values(DB_STAGE_NAMES)) pending.delete(name);
        pending.add(DB_STAGE_NAMES[stage]);
      }, namespace),
      Object.values(DB_STAGE_NAMES)
    ),
    step('file storage', openBlobStore(namespace)),
  ]);

  // Documents are CRDTs; this store owns the open ones and their persistence.
  // Both the repository and the version store read through it, so they always
  // agree about what a document currently is.
  const documentCrdt = createDocumentCrdtStore(db);

  // Everything the user edits in place — creating, renaming, moving,
  // starring, deleting — shows the moment it is asked for. A live query
  // lags a write by the durable flush plus a full re-run; the optimistic
  // layer shows the intended outcome until the sources catch up, and falls
  // back to them if a write fails.
  const optimistic = createOptimisticEntities();
  const {
    files,
    tree: fileTree,
    documents,
    documentList,
  } = createOptimisticFiles({
    entities: optimistic,
    files: createPgliteFileRepository(db, blobs, blobs.packages),
    tree: createPgliteFileTreeReader(db),
    documents: createPgliteDocumentRepository(db, documentCrdt),
    documentList: createPgliteDocumentListReader(db),
    onError: reportError,
  });

  // Best-effort storage may be evicted wholesale under disk pressure —
  // files and database together. Persistence was requested by the blob
  // worker; a denial is worth one warning, not silence.
  if (!blobs.persisted) {
    reportError(
      "The browser may evict this app's local data under disk pressure. Data stays safest when the app is used regularly or installed."
    );
  }

  return {
    db,
    documents,
    documentList,
    documentVersions: createPgliteDocumentVersionStore(db, documentCrdt),
    files,
    fileTree,
    blobs,
    packages: createPglitePackageRepository(
      db,
      blobs,
      blobs.packages,
      PACKAGE_KINDS
    ),
    packageList: createPglitePackageReader(db),
    settings: createPgliteSettingsStore(db),
    graph: createPgliteGraphReader(db),
    graphCommands: createPgliteGraphRepository(db),
    identity: { userId: session.userId, spaceId: session.spaceId },
    reportError,
  };
}
