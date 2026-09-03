import { live } from '@electric-sql/pglite/live';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { migrate } from './migrate.js';

/**
 * Leader-election key. PGlite derives one from the worker's module URL when
 * none is given, which is not stable in dev (the bundler rewrites that URL),
 * so two tabs could each elect themselves leader and then fight over the same
 * IndexedDB directory. Naming it explicitly makes "same database" mean the
 * same thing in every tab, on every reload, in dev and in a build.
 */
const DB_ID = 'proflow';

/**
 * The app's own single-file OPFS store (see db/pack): sync access handles
 * for speed, but three of them in total rather than one per Postgres file.
 * The directory name is the one PGlite's access-handle-pool layout used
 * too; a database in that layout cannot be read by this one, and the pack
 * store leaves it alone — its files are removed on the next "delete local
 * data", which takes the whole directory.
 */
const DB_DATA_DIR = 'opfs-pack://proflow';

/**
 * Where an open is: electing a worker, running the schema, or waiting for
 * another context to let go of the database files.
 */
export type OpenStage = 'worker' | 'migration' | 'held';

/**
 * Set when a deletion could not finish because another context still held
 * the database open (the agent worker, another tab). The next start —
 * before any worker has opened a handle — finishes the job.
 */
const TOMBSTONE_KEY = 'proflow.db.deleteOnBoot';

async function settleTombstone(): Promise<void> {
  // Workers have no localStorage; the main thread settles this before any
  // worker exists, which is exactly the window with no handles held.
  const storage = globalThis.localStorage;
  if (!storage || storage.getItem(TOMBSTONE_KEY) === null) return;
  await removeDatabaseStorage();
  storage.removeItem(TOMBSTONE_KEY);
}

/** How long to wait between attempts while another context holds the files. */
const HELD_RETRY_MS = 1_000;

/**
 * Opens (and migrates) the local database. Called once per context: the
 * app's composition root and the agent worker each open their own client.
 *
 * Nothing here ever deletes the database on its own initiative. An earlier
 * version read the VFS state file before booting and rebuilt the database
 * from empty when the free-file pool in it was empty — but that state is
 * not a wedge: the VFS tops its pool back up while opening, and a database
 * checkpointed with an empty pool opens with its data intact. The check
 * was a false positive that cost the user everything they had stored, and
 * when the deletion could not complete (another context holding the files)
 * it went on to open anyway and the start-up hung for good.
 *
 * The one failure worth handling is that last one: another context holding
 * sync access handles on the files — a tab still tearing down, a worker of
 * a previous page — makes the worker's open fail in a way the worker
 * protocol never reports (it waits for a leader that never comes). The
 * worker reports it itself; the open then waits for the holder to go and
 * tries again, saying so through `onStage` so the boot screen can tell the
 * user which tab to close.
 */
export async function openLocalDatabase(
  onStage: (stage: OpenStage) => void = () => {}
) {
  await settleTombstone();
  for (;;) {
    try {
      return await openOnce(onStage);
    } catch (e) {
      if (!(e instanceof WorkerInitFailure) || !e.filesHeld) throw e;
      onStage('held');
      await new Promise((r) => setTimeout(r, HELD_RETRY_MS));
    }
  }
}

/**
 * The worker's own report that PGlite failed to initialise — see
 * pglite.worker.ts. Without it the page's await never rejects: the worker
 * protocol keeps the page waiting for a leader that will never announce
 * itself, while the actual error is an unhandled rejection in the worker.
 */
class WorkerInitFailure extends Error {
  /** Another context holds the files: transient, wait for it to let go. */
  readonly filesHeld: boolean;
  constructor(message: string, name: string) {
    const filesMissing = name === 'NotFoundError';
    super(
      filesMissing
        ? 'the local database is missing some of its files (a deletion ' +
            'that did not finish); it cannot open — delete the local data ' +
            'to start over'
        : `the database worker could not open its files: ${message}`
    );
    this.name = 'WorkerInitFailure';
    // Chrome's wording for a sync access handle someone else holds, and
    // the DOMException the OPFS API raises for the same condition.
    this.filesHeld =
      !filesMissing &&
      /access handle|NoModificationAllowedError/i.test(message);
  }
}

async function openOnce(onStage: (stage: OpenStage) => void) {
  // Two waits with different failure modes: the first includes electing a
  // leader among the open tabs, the second a lock shared with them. A
  // start-up that stalls should say which of the two it is waiting on.
  onStage('worker');
  const workerInstance = new Worker(
    new URL('./pglite.worker.ts', import.meta.url),
    { type: 'module' }
  );
  const initFailed = new Promise<never>((_, reject) => {
    workerInstance.addEventListener('message', (event) => {
      if (event.data?.type === 'proflow:init-failed') {
        reject(
          new WorkerInitFailure(
            String(event.data.message),
            String(event.data.name ?? '')
          )
        );
      }
    });
  });
  // Only ever observed through the races below; a report that lands after
  // the open has succeeded (it cannot) must not surface as unhandled.
  initFailed.catch(() => {});
  try {
    // `create` resolves once the worker has announced itself, BEFORE the
    // leader's database is open: the wait for that happens in `waitReady`,
    // and it is there — not in `create` — that a failed open would hang.
    const db = await PGliteWorker.create(workerInstance, {
      id: DB_ID,
      dataDir: DB_DATA_DIR,
      extensions: { live },
    });
    await Promise.race([db.waitReady, initFailed]);
    hardenAgainstLeaderChange(db);
    onStage('migration');
    await migrate(db);
    return db;
  } catch (e) {
    // Whatever failed, the worker behind it may hold sync access handles
    // on the pool files; only termination reliably releases them, and the
    // next attempt needs them released.
    workerInstance.terminate();
    throw e;
  }
}

/**
 * Deletes the local database outright — the file the VFS keeps it in, not
 * its contents.
 *
 * The IndexedDB databases are ENUMERATED rather than named. What the
 * IndexedDB VFS calls its database is derived from where it mounts the data
 * directory, which is the driver's business and has changed between
 * versions; a hard-coded name that stops matching would fail silently,
 * leaving behind exactly what the caller asked to be rid of. Every
 * database on this origin belongs to this app, so taking all of them is
 * both correct and proof against that.
 *
 * A database another context still holds open cannot be deleted yet: an
 * IndexedDB deletion is left pending, an OPFS removal is refused outright
 * — and the agent worker holds a connection until its page goes. The
 * tombstone carries the intent across the reload that follows: the next
 * start deletes the storage before any worker has opened a handle. This
 * call resolves regardless; say so to the user rather than waiting.
 */
export async function deleteLocalDatabase(db: {
  close(): Promise<void>;
}): Promise<void> {
  // Intent first: even a deletion that dies mid-way finishes next boot.
  globalThis.localStorage?.setItem(TOMBSTONE_KEY, String(Date.now()));
  await db.close().catch(() => {});
  await removeDatabaseStorage();
}

/**
 * Deletes the local database without an open client — for a start-up that
 * failed, where no client exists and the user has chosen to start over.
 * The intent is recorded first, as above: a worker of the failed start
 * may still hold handles, and then the next start finishes the deletion
 * before any worker of its own exists.
 */
export async function deleteLocalDatabaseStorage(): Promise<void> {
  globalThis.localStorage?.setItem(TOMBSTONE_KEY, String(Date.now()));
  await removeDatabaseStorage();
}

async function removeDatabaseStorage(): Promise<void> {
  const listed = await globalThis.indexedDB
    ?.databases?.()
    .catch(() => [] as IDBDatabaseInfo[]);
  const names = (listed ?? [])
    .map((info) => info.name)
    .filter((name): name is string => Boolean(name));
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })
    )
  );
  // The database directory is removed whole — every layout that ever lived
  // there goes with it. The OPFS root is shared with the blob store, whose
  // directories must survive a database deletion, so the entry is named,
  // never enumerated. A removal refused because a worker still holds a
  // handle is retried briefly; past that, the tombstone finishes the job
  // next boot.
  if (navigator?.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory().catch(() => null);
    if (root) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await root.removeEntry('proflow', { recursive: true });
          break;
        } catch (e) {
          // Already gone (never on OPFS, or a previous attempt won).
          if (e instanceof DOMException && e.name === 'NotFoundError') break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  }
}

/**
 * Closing the tab that won the leader election rejects every operation in
 * flight everywhere else with "Leader changed, pending operation in
 * indeterminate state". For this database that is a retryable condition,
 * not an error: reads are pure, and every write is idempotent — inserts
 * are keyed by client-minted ids, updates set absolute values — so running
 * one again after the new leader is elected is safe on either side of the
 * indeterminacy. Live queries heal themselves one layer down: their retry
 * lands on "prepared statement does not exist" in the new leader, which
 * the live extension answers by rebuilding the query.
 */
function hardenAgainstLeaderChange(db: {
  query: (...args: never[]) => Promise<unknown>;
  exec: (...args: never[]) => Promise<unknown>;
  transaction: (...args: never[]) => Promise<unknown>;
  waitReady: Promise<void>;
}): void {
  const isLeaderChange = (e: unknown) =>
    e instanceof Error && /leader changed/i.test(e.message);
  // Fire-and-forget work — releasing a live query's listener, refreshing an
  // index — has no awaiter to hear the rejection and retry. For those the
  // indeterminate outcome is acceptable by design; anything awaited still
  // receives its own rejection and goes through the retry below.
  globalThis.addEventListener?.('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (isLeaderChange(reason)) event.preventDefault();
  });
  const retrying = <A extends never[], R>(run: (...args: A) => Promise<R>) => {
    return async (...args: A): Promise<R> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await run(...args);
        } catch (e) {
          if (attempt >= 5 || !isLeaderChange(e)) throw e;
          // Re-election takes as long as it takes; back off across ~5s.
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          await db.waitReady;
        }
      }
    };
  };
  db.query = retrying(db.query.bind(db));
  db.exec = retrying(db.exec.bind(db));
  db.transaction = retrying(db.transaction.bind(db));
}

export type AppDb = Awaited<ReturnType<typeof openLocalDatabase>>;
