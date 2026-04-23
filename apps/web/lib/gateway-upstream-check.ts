import { NextResponse } from 'next/server';

import { GATEWAY_HOST, GATEWAY_UPSTREAMS } from '@/lib/gateway-config';

/** Avoid a probe on every gateway request once an upstream is known to be up. */
const SUCCESS_CACHE_MS = 5000;

/** Cold Turbopack / first compile often exceeds sub-second probes; do not cache failures (avoids false “app isn’t running” until F5). */
const PROBE_TIMEOUT_MS = Number(
  process.env.GATEWAY_UPSTREAM_PROBE_TIMEOUT_MS ?? 3000
);
const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_GAP_MS = 120;

const successUntil = new Map<string, number>();

export function matchGatewayUpstream(pathname: string) {
  for (const up of GATEWAY_UPSTREAMS) {
    if (pathname === up.prefix || pathname.startsWith(`${up.prefix}/`)) {
      return up;
    }
  }
  return null;
}

/**
 * Returns true if the dev server accepts TCP/HTTP (any HTTP status counts as up).
 */
export async function isGatewayUpstreamReachable(
  upstream: (typeof GATEWAY_UPSTREAMS)[number]
): Promise<boolean> {
  const now = Date.now();
  const okUntil = successUntil.get(upstream.name);
  if (okUntil !== undefined && now < okUntil) {
    return true;
  }

  const url = `http://${GATEWAY_HOST}:${upstream.port}${upstream.prefix}`;

  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, PROBE_RETRY_GAP_MS));
    }
    for (const method of ['HEAD', 'GET'] as const) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          redirect: 'manual',
        });
        clearTimeout(timeout);
        successUntil.set(upstream.name, Date.now() + SUCCESS_CACHE_MS);
        void res.body?.cancel();
        return true;
      } catch {
        clearTimeout(timeout);
      }
    }
  }

  successUntil.delete(upstream.name);
  return false;
}

const APP_HINT: Record<string, string> = {
  platform: 'apps/platform',
  author: 'apps/author',
};

export function gatewayUpstreamStubResponse(
  upstream: (typeof GATEWAY_UPSTREAMS)[number]
): NextResponse {
  const hint = APP_HINT[upstream.name] ?? `apps/${upstream.name}`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Service unavailable — ${upstream.name}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 36rem; margin: 0 auto; line-height: 1.5; }
    code { font-size: 0.9em; }
    a { color: inherit; }
  </style>
</head>
<body>
  <h1>This app isn’t running</h1>
  <p>
    The <strong>${upstream.name}</strong> dev server isn’t reachable at
    <code>http://${GATEWAY_HOST}:${upstream.port}</code>.
    Start it in another terminal (for example <code>cd ${hint} && bun dev</code>),
    then refresh — or try again in a moment.
  </p>
  <p><a href="/">← Back to home</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
