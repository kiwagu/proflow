import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import { vector } from '@electric-sql/pglite-pgvector';
import { servePackMaintenance } from './pack/maintenance.js';
import { OpfsPackFS } from './pack/opfs-pack.fs.js';

// The database lives in a worker; tabs connect through PGliteWorker, which
// elects a leader and proxies every non-leader tab to it (PGlite is
// single-connection). `init` therefore runs in exactly one tab.
//
// The options arrive from the client so that the leader-election key and the
// data directory are decided in one place — see db.ts. `vector` is a WASM
// Postgres extension and must load HERE; `live` is a client-side plugin and
// is registered on the PGliteWorker instead.
// When the elected leader's tab closes, the worker library rejects every
// operation it was proxying with "Leader changed, pending operation in
// indeterminate state". The operations' owners hear the same rejection
// through their own promises and retry against the new leader (db.ts);
// this copy is the library's internal bookkeeping with no one awaiting
// it, and unhandled it surfaces as an uncaught error in every surviving
// tab. Only that exact rejection is silenced.
self.addEventListener('unhandledrejection', (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  if (reason instanceof Error && /leader changed/i.test(reason.message)) {
    event.preventDefault();
  }
});

// A failed open is NOT healed here, deliberately. The file system opens
// sync access handles before PGlite finishes initialising, and a PGlite
// instance that failed mid-init has no close path that releases them — so
// any in-worker retry that first deletes the directory hits
// NoModificationAllowedError on its own leftovers. The only reliable way to
// release the handles is to tear the worker down; db.ts owns that (it holds
// the Worker object) and retries in a fresh worker.
//
// It is REPORTED here, though, because nothing else reports it: the worker
// protocol does not await `init` where a failure would reach the page — it
// keeps the page waiting for a leader that never announces itself, and the
// error ends as an unhandled rejection in this worker. The page listens for
// this one message on the Worker object; the protocol ignores it.
worker({
  async init(options) {
    // The database lives in ONE OPFS file (plus two small state slots), so
    // it holds three sync access handles however large it grows. PGlite's
    // own OPFS file system holds one per Postgres file — over a thousand for
    // an empty database — and a browser that caps a tab's descriptors below
    // that (Ubuntu's Chromium snap at 1,024, Safari at 252) can never open
    // it; see the pack file system for the details.
    const t0 = performance.now();
    const fs = new OpfsPackFS(stripScheme(options.dataDir ?? ''));
    const db = new PGlite({
      fs,
      extensions: { vector },
      // Durability is deliberately NOT relaxed: a local-first app that loses
      // the note you just typed because the tab closed before an async flush
      // has failed at its one job.
    });
    // A directory whose state file names files that are no longer there
    // (a deletion interrupted half-way) never settles the open at all: the
    // file system opens its handles inside promise executors that throw
    // asynchronously, so `waitReady` neither resolves nor rejects, and the
    // only trace is an unhandled NotFoundError here. Report it as the
    // failure it is.
    const missing = new Promise<never>((_, reject) => {
      self.addEventListener('unhandledrejection', (event) => {
        const reason = (event as PromiseRejectionEvent).reason;
        if (reason instanceof DOMException && reason.name === 'NotFoundError') {
          reject(reason);
        }
      });
    });
    try {
      await Promise.race([db.waitReady, missing]);
    } catch (e) {
      // PGlite wraps the cause; its message is what names the condition.
      const cause =
        e instanceof Error && e.cause instanceof Error ? e.cause : e;
      const message = cause instanceof Error ? cause.message : String(cause);
      const name = cause instanceof Error ? cause.name : '';
      self.postMessage({ type: 'proflow:init-failed', message, name });
      throw e;
    }
    console.log(
      `[pglite] opfs pack ready in ${Math.round(performance.now() - t0)}ms`
    );
    // Compaction moves blocks under Postgres's feet; a transaction holds
    // the connection's exclusive lock, so nothing runs while it does.
    servePackMaintenance(
      fs,
      (work) =>
        db.transaction(async () => work()) as Promise<
          Awaited<ReturnType<typeof work>>
        >
    );
    return db;
  },
});

/** `opfs-pack://proflow` → `proflow`; the fs class takes a bare directory path. */
function stripScheme(dataDir: string): string {
  return dataDir.replace(/^[a-z-]+:\/\//, '');
}
