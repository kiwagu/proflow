import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import { getGatewayPlatformPath } from '@workspace/gateway-auth/gateway-paths';
import { platformSignInBaseUrl } from '@workspace/gateway-auth/site-origin';
import { safeNextPath } from '@workspace/gateway-auth/safe-next-path';

/** @deprecated use getGatewayPlatformPath from @workspace/gateway-auth/gateway-paths */
export const PLATFORM_APP_PATH = getGatewayPlatformPath();

/**
 * Browser redirect target for sign-in when Supabase has no session.
 * Set `NEXT_PUBLIC_GATEWAY_ORIGIN` when author runs on its own dev port (e.g. 3002)
 * so cookies align with the gateway (e.g. http://localhost:3000).
 */
export function getPlatformLoginHref(): string {
  return platformSignInBaseUrl();
}

/**
 * Same as `getPlatformLoginHref` but adds `next` for return to an authenticated author URL after login.
 */
export function getPlatformLoginHrefWithReturn(returnPath: string): string {
  const pathOnly = returnPath.split('?')[0];
  if (!safeNextPath(pathOnly) || !pathOnly.startsWith(AUTHOR_BASE_PATH)) {
    return getPlatformLoginHref();
  }
  const base = platformSignInBaseUrl().split('?')[0];
  return `${base}?${new URLSearchParams({ next: returnPath }).toString()}`;
}

/** Current author URL (pathname + search) for `next`, or `/author` if invalid. */
export function clientAuthorReturnPath(): string {
  if (typeof window === 'undefined') {
    return AUTHOR_BASE_PATH;
  }
  const full = window.location.pathname + window.location.search;
  const pathOnly = full.split('?')[0];
  if (!safeNextPath(pathOnly) || !pathOnly.startsWith(AUTHOR_BASE_PATH)) {
    return AUTHOR_BASE_PATH;
  }
  return full;
}

/** Absolute path for author API routes from the browser (includes basePath). */
export function authorApiPath(suffix: string): string {
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${AUTHOR_BASE_PATH}${s}`;
}
