import {
  getGatewayAuthorPath,
  getGatewayPlatformPath,
} from '@workspace/gateway-auth/gateway-paths';
import { PLATFORM_LOCALE_URL_STRATEGY } from '@workspace/settings-runtime';

/**
 * Dev gateway + production routing map.
 *
 * In development, `apps/web` (port 3000, `/`) proxies these prefixes to local apps.
 * In production, mirror the same path → upstream mapping in nginx (see
 * `gateway/nginx-snippet.example.conf`). Set forwarding headers there so auth
 * redirects (`inferSiteOrigin`, `next=` query) use the public hostname and scheme.
 * Path prefixes must match `NEXT_PUBLIC_GATEWAY_PLATFORM_PATH` / `NEXT_PUBLIC_GATEWAY_AUTHOR_PATH` (defaults `/platform`, `/author`).
 *
 * UI: use `<a href="...">` (full navigation) for these prefixes, not `next/link`.
 * Use `@workspace/ui/common/external-gateway-link` from apps with Next `basePath`.
 */

export const GATEWAY_HOST = process.env.GATEWAY_UPSTREAM_HOST ?? '127.0.0.1';

export const GATEWAY_ENTRY_ORIGIN =
  process.env.GATEWAY_ENTRY_ORIGIN ?? 'http://localhost:3000';

/** Locale in URL uses the shared basePath-aligned strategy (`basepath`). */
export const GATEWAY_LOCALE_URL_STRATEGY = PLATFORM_LOCALE_URL_STRATEGY;

const platformPrefix = getGatewayPlatformPath();
const authorPrefix = getGatewayAuthorPath();

/** Path prefixes proxied to other apps (not the web shell). */
export const GATEWAY_ROUTE_PREFIXES = [platformPrefix, authorPrefix] as const;

export type GatewayRoutePrefix = (typeof GATEWAY_ROUTE_PREFIXES)[number];

export const GATEWAY_UPSTREAMS = [
  {
    name: 'platform',
    prefix: platformPrefix satisfies GatewayRoutePrefix,
    port: Number(process.env.PLATFORM_DEV_PORT ?? 3001),
    // A Next app with a basePath answers its bare mount itself.
    entry: platformPrefix,
  },
  {
    name: 'author',
    prefix: authorPrefix satisfies GatewayRoutePrefix,
    port: Number(process.env.AUTHOR_DEV_PORT ?? 3002),
    // The workbench SPA (apps/workbench) lives under `<mount>/`: its dev
    // server answers nothing at the bare mount, so the gateway sends the
    // bare-mount visit to the slash form where its index is.
    entry: `${authorPrefix}/`,
  },
] as const;

export function isGatewayPath(pathname: string): boolean {
  return GATEWAY_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function devRewriteRules(): Array<{
  source: string;
  destination: string;
}> {
  return GATEWAY_UPSTREAMS.flatMap(({ prefix, port, entry }) => {
    const base = `http://${GATEWAY_HOST}:${port}`;
    return [
      { source: prefix, destination: `${base}${entry}` },
      { source: `${prefix}/`, destination: `${base}${prefix}/` },
      { source: `${prefix}/:path*`, destination: `${base}${prefix}/:path*` },
    ];
  });
}

/**
 * Where the workbench's production build is staged inside this app's
 * `public/` directory, so Next serves it as static files under the author
 * mount. The directory name IS the mount: `public/author/index.html` answers
 * `/author/index.html`. Filled by `stage:workbench` before `next build`;
 * never committed.
 */
export const WORKBENCH_PUBLIC_DIR = authorPrefix.replace(/^\//, '');

/**
 * Production routing for the workbench SPA: any path under the mount that is
 * not one of its files is a client-side route, answered with the SPA's
 * index for the app to resolve. Built assets are excluded so a missing one
 * is a 404, not a page — a hashed chunk that 404s after a deploy must fail
 * loudly rather than "load" as HTML.
 */
export function workbenchFallbackRules(): Array<{
  source: string;
  destination: string;
}> {
  const index = `${authorPrefix}/index.html`;
  return [
    { source: authorPrefix, destination: index },
    { source: `${authorPrefix}/:path((?!assets/).*)`, destination: index },
  ];
}
