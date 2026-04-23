import { getGatewayPlatformPath } from './gateway-paths';

/** Default dev gateway entry (apps/web); author runs on `AUTHOR_DEV_PORT` (3002) in isolation. */
const DEFAULT_DEV_GATEWAY_ORIGIN = 'http://localhost:3000';

/**
 * Public site origin for absolute redirects (avoids Next `basePath` joining the platform prefix incorrectly).
 * Production: reverse proxy should pass `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.
 * Prefer `NEXT_PUBLIC_GATEWAY_ORIGIN=https://your-domain` in prod so URLs stay canonical.
 */
export function inferSiteOrigin(headers: Headers): string {
  const hostRaw = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!hostRaw) {
    return DEFAULT_DEV_GATEWAY_ORIGIN;
  }
  const host = hostRaw.split(',')[0]?.trim() ?? hostRaw;
  let proto = headers.get('x-forwarded-proto') ?? 'http';
  const hostLower = host.toLowerCase();
  const isLoopback =
    hostLower === 'localhost' ||
    hostLower.startsWith('localhost:') ||
    hostLower.startsWith('127.0.0.1');
  /*
   * Next dev on :3001 speaks HTTP only. Proxies sometimes forward
   * X-Forwarded-Proto=https from the public TLS hop, which would build
   * https://localhost:3001/... and break the browser (SSL_ERROR_RX_RECORD_TOO_LONG).
   */
  if (isLoopback && process.env.NODE_ENV === 'development') {
    proto = 'http';
  }
  return `${proto}://${host}`;
}

/**
 * When author is opened directly on its dev port (e.g. :3002), `Host` is wrong for platform sign-in:
 * `/platform` is mounted on the gateway (e.g. :3000), not on author. Map to the default dev gateway.
 */
function devGatewayOriginWhenAuthorDevPort(
  inferredOrigin: string
): string | null {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  try {
    const u = new URL(inferredOrigin);
    const authorPort = process.env.AUTHOR_DEV_PORT ?? '3002';
    if (u.hostname === 'localhost' && u.port === authorPort) {
      return DEFAULT_DEV_GATEWAY_ORIGIN;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Origin the browser should use (gateway / public URL), not the upstream app port.
 * Prefer `NEXT_PUBLIC_GATEWAY_ORIGIN`, then `GATEWAY_ENTRY_ORIGIN` (same as apps/web in monorepo dev).
 */
export function resolvePublicSiteOrigin(headers: Headers): string {
  const explicit =
    process.env.NEXT_PUBLIC_GATEWAY_ORIGIN?.replace(/\/$/, '') ||
    process.env.GATEWAY_ENTRY_ORIGIN?.replace(/\/$/, '');
  if (explicit) {
    return explicit;
  }
  const inferred = inferSiteOrigin(headers);
  return devGatewayOriginWhenAuthorDevPort(inferred) ?? inferred;
}

/**
 * Base URL of the platform sign-in shell for the current deployment (`NEXT_PUBLIC_GATEWAY_PLATFORM_PATH`, default `/platform`).
 */
export function platformSignInBaseUrl(): string {
  const platformPath = getGatewayPlatformPath();
  const gateway =
    process.env.NEXT_PUBLIC_GATEWAY_ORIGIN?.replace(/\/$/, '') ||
    process.env.GATEWAY_ENTRY_ORIGIN?.replace(/\/$/, '');
  if (gateway) {
    return `${gateway}${platformPath}`;
  }
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    if (process.env.NODE_ENV === 'development') {
      try {
        const u = new URL(origin);
        if (u.hostname === 'localhost' && u.port === '3002') {
          return `${DEFAULT_DEV_GATEWAY_ORIGIN}${platformPath}`;
        }
      } catch {
        /* ignore */
      }
    }
    return `${origin}${platformPath}`;
  }
  return `${DEFAULT_DEV_GATEWAY_ORIGIN}${platformPath}`;
}

/**
 * Builds absolute platform sign-in URL with `next` return path.
 * Pass `requestHeaders` on the server so origin matches the browser (behind nginx).
 */
export function buildPlatformSignInUrl(
  returnPath: string,
  requestHeaders?: Headers
): string {
  const platformPath = getGatewayPlatformPath();
  const params = new URLSearchParams({ next: returnPath });
  const pathAndQuery = `${platformPath}?${params.toString()}`;
  const origin = resolvePublicSiteOrigin(requestHeaders ?? new Headers());
  return `${origin}${pathAndQuery}`;
}
