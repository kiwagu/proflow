/**
 * Gateway path prefixes — override via env (must match nginx + each app `basePath`).
 * When you change a mount, set both `NEXT_PUBLIC_GATEWAY_*_PATH` and that app’s
 * `NEXT_PUBLIC_APP_BASE_PATH` to the same value so sign-in URLs and Next `basePath` stay aligned.
 */

function normalizeGatewayPrefix(p: string): string {
  const t = p.trim();
  if (!t || t === '/') {
    return '/';
  }
  const withSlash = t.startsWith('/') ? t : `/${t}`;
  return withSlash.replace(/\/$/, '') || '/';
}

/** Platform app mount on the gateway (sign-in shell). Default `/platform`. */
export function getGatewayPlatformPath(): string {
  return normalizeGatewayPrefix(
    process.env.NEXT_PUBLIC_GATEWAY_PLATFORM_PATH ?? '/platform'
  );
}

/** Author app mount. Default `/author`. */
export function getGatewayAuthorPath(): string {
  return normalizeGatewayPrefix(
    process.env.NEXT_PUBLIC_GATEWAY_AUTHOR_PATH ?? '/author'
  );
}

/**
 * This Next app's `basePath` (same value as in `next.config`).
 * Prefer `NEXT_PUBLIC_APP_BASE_PATH`; otherwise `fallback` (e.g. `'/platform'` for apps/platform).
 */
export function getAppBasePath(fallback: string): string {
  const v = process.env.NEXT_PUBLIC_APP_BASE_PATH;
  if (v) {
    return normalizeGatewayPrefix(v);
  }
  return normalizeGatewayPrefix(fallback);
}

/**
 * Full gateway URL path for a platform internal route (e.g. `/auth/login` → `/platform/auth/login`).
 */
export function gatewayPlatformMountedPath(internalPath: string): string {
  const mount = getGatewayPlatformPath();
  const p = internalPath.startsWith('/') ? internalPath : `/${internalPath}`;
  if (mount === '/') {
    return p;
  }
  if (p === '/') {
    return mount;
  }
  return `${mount}${p}`;
}
