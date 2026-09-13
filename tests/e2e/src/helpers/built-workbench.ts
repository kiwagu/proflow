import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A local origin that serves the workbench's PRODUCTION build.
 *
 * The offline shell only exists in a build: the dev server has no service
 * worker to register, so an offline reload cannot be measured against the
 * running dev stand at all. This stands up a second origin where the app's
 * own files come from `apps/workbench/dist` and everything else — the
 * login form, the session check — is proxied to the gateway the rest of
 * the suite already uses. Same cookies, same API, real built app.
 *
 * `127.0.0.1` is a secure context by the loopback rule, which is what a
 * service worker requires; no certificate is involved.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../../../../apps/workbench/dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.map': 'application/json; charset=utf-8',
};

export interface BuiltWorkbenchOrigin {
  origin: string;
  close(): Promise<void>;
}

/**
 * Re-hosts account cookies onto this harness's origin.
 *
 * Sign-in happens on the gateway, whose dev server only hydrates its React
 * app for the hostnames it was configured with — this harness is on
 * another one by necessity, so its login form would never run. The session
 * itself is a cookie the API route reads, so a context signed in against
 * the gateway hands its cookies over and the built app is exercised with a
 * real session.
 */
export function rehostCookies(
  cookies: { name: string; value: string; path: string }[],
  origin: string
): {
  name: string;
  value: string;
  domain: string;
  path: string;
}[] {
  const { hostname } = new URL(origin);
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: hostname,
    path: cookie.path,
  }));
}

export async function serveBuiltWorkbench(
  options: {
    /** The app's mount, with a trailing slash. */
    base?: string;
    /** Where everything outside the mount goes. */
    upstream?: string;
  } = {}
): Promise<BuiltWorkbenchOrigin> {
  const base = options.base ?? '/author/';
  const upstream = new URL(
    options.upstream ??
      process.env.PLAYWRIGHT_BASE_URL ??
      'https://proflow.local'
  );

  const built = await stat(path.join(DIST, 'sw.js')).catch(() => null);
  if (!built) {
    throw new Error(
      `No workbench build at ${DIST} — run \`bun run --cwd apps/workbench build\` first.`
    );
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://placeholder');
    if (url.pathname.startsWith(base) || url.pathname === base.slice(0, -1)) {
      void serveFile(url.pathname, base, response);
      return;
    }
    proxy(request, response, upstream);
  });

  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      resolve();
    })
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('the built-workbench origin did not get a port');

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

async function serveFile(
  pathname: string,
  base: string,
  response: http.ServerResponse
): Promise<void> {
  const relative = pathname.slice(base.length).replace(/^\/+/, '');
  // The same fallback the gateway applies: anything under the mount that
  // is not a built file is a client-side route answered with the page —
  // except under `assets/`, where a miss must stay a miss.
  const candidate = relative === '' ? 'index.html' : relative;
  const file = path.resolve(DIST, candidate);
  const inside = file === DIST || file.startsWith(`${DIST}${path.sep}`);
  const found = inside ? await stat(file).catch(() => null) : null;

  if (found?.isFile()) {
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': found.size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(response);
    return;
  }

  if (candidate.startsWith('assets/')) {
    response.writeHead(404).end('not found');
    return;
  }

  const index = path.join(DIST, 'index.html');
  const indexStat = await stat(index);
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': indexStat.size,
    'cache-control': 'no-cache',
  });
  createReadStream(index).pipe(response);
}

function proxy(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  upstream: URL
): void {
  // The upstream is a dev server that rejects requests from an origin it
  // was not configured for (its cross-origin dev guard), and this harness
  // necessarily runs on a different one. Presenting as the upstream's own
  // host keeps that guard satisfied; nothing else about the request — the
  // cookies, the body, the path — is touched.
  const headers: http.OutgoingHttpHeaders = {
    ...request.headers,
    host: upstream.host,
  };
  if (headers.origin) headers.origin = upstream.origin;
  if (typeof headers.referer === 'string')
    headers.referer = headers.referer.replace(
      /^https?:\/\/[^/]+/,
      upstream.origin
    );

  const transport = upstream.protocol === 'https:' ? https : http;
  const forwarded = transport.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      method: request.method,
      path: request.url,
      headers,
      // The stand serves a locally-issued certificate, the same one the
      // suite's browser context is told to accept.
      rejectUnauthorized: false,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers
      );
      upstreamResponse.pipe(response);
    }
  );
  forwarded.on('error', () => {
    // The gateway being unreachable is exactly what an offline case
    // simulates; answer the way a dead upstream would.
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(forwarded);
}
