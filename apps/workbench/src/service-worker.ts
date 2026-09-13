/**
 * The offline shell.
 *
 * The app tells the user its documents live on this device; without a
 * worker serving its own files that promise only holds for a tab that is
 * already open, because a reload asks the network for every asset. This
 * worker makes the reload work.
 *
 * It is generated at build time: the build replaces the three constants
 * below with the mount, a version derived from the built files, and the
 * list of files to keep. Nothing here is configurable at runtime.
 *
 * Scope is the app's own mount and nothing wider. Another app lives beside
 * this one on the same origin, and its requests — the session check above
 * all — must reach the network and fail honestly when there is none. A
 * cached session answer would tell a signed-out visitor they are signed in.
 */
declare const __SW_BASE__: string;
declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: readonly string[];

const sw = self as unknown as ServiceWorkerGlobalScope;

/** The app's mount, with its trailing slash (e.g. `/author/`). */
const BASE = __SW_BASE__;

/** Derived from the built files: a new build is a new pair of caches. */
const VERSION = __SW_VERSION__;

/**
 * Everything the editor needs to open with no network: the page, its
 * styles, the start-up chunks, the database engine and the CRDT. The
 * embedding runtime is deliberately absent — start-up does not wait for
 * it, and it is the single largest file in the build, so it is kept only
 * once something has actually asked for it.
 */
const PRECACHE = __SW_PRECACHE__;

const SHELL_CACHE = `workbench-shell-${VERSION}`;
const RUNTIME_CACHE = `workbench-runtime-${VERSION}`;
const CACHE_PREFIX = 'workbench-';

const INDEX = `${BASE}index.html`;
const ASSETS = `${BASE}assets/`;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([...PRECACHE]))
  );
});

/**
 * One generation at a time. The shell alone is tens of megabytes, so a
 * previous build's caches are dropped the moment this one takes over
 * rather than lingering as a second copy of everything.
 */
sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(CACHE_PREFIX) &&
              name !== SHELL_CACHE &&
              name !== RUNTIME_CACHE
          )
          .map((name) => caches.delete(name))
      );
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Everything outside this app's own mount — another origin, the other
  // app on this one, its API — is none of this worker's business.
  if (url.origin !== sw.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;
  // Source maps are a debugging artefact, not part of the app.
  if (url.pathname.endsWith('.map')) return;

  if (request.mode === 'navigate') {
    // The same rule the server applies: any path under the mount that is
    // not a built file is a client-side route, answered with the app's
    // page. Without it a reload on a nested path is a 404 offline.
    if (url.pathname.startsWith(ASSETS)) return;
    event.respondWith(openPage());
    return;
  }

  event.respondWith(openAsset(request));
});

/** The page, from the shell cache; the network only if it is missing. */
async function openPage(): Promise<Response> {
  const cached = await caches.match(INDEX);
  if (cached) return cached;
  try {
    return await fetch(INDEX);
  } catch {
    return offline();
  }
}

/**
 * Built file names carry a content hash, so a cached one can never be
 * stale: a hit is served as-is, and anything else is fetched once and
 * kept. That second half is what makes the embedding runtime available
 * offline after the first search that needed it, and only then.
 */
async function openAsset(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, copy);
    }
    return response;
  } catch {
    return offline();
  }
}

function offline(): Response {
  return new Response('Offline and not stored on this device.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * A waiting worker activates only when a page asks it to, never on its
 * own. The local database is exclusive to one page at a time, and a
 * silent takeover would hand a new build's code a database the previous
 * build's page still holds; the app offers the update and reloads itself
 * instead.
 */
sw.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'workbench-apply-update') void sw.skipWaiting();
});
