import type { NextRequest } from 'next/server';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import { gatewayReturnPathForApp } from '@workspace/gateway-auth/gateway-return-path';

/**
 * Gateway path for the author app root (used as `next` after platform sign-in).
 */
export const AUTHOR_RETURN_PATH = AUTHOR_BASE_PATH;

/**
 * Full gateway path to return to after platform sign-in (pathname + search).
 * The proxy now redirects guests directly to platform with the final target path
 * (e.g. `/author/admin`), not through `/admin/login`.
 */
export function authorReturnPathFromRequest(request: NextRequest): string {
  return gatewayReturnPathForApp(request, AUTHOR_BASE_PATH);
}

/**
 * Never use Payload's `/admin/login` as `next=` after platform sign-in: that route is not part of
 * the Supabase IdP flow and would loop or show the wrong screen. Normalize to `/author/admin`
 * (under the configured author base path).
 */
export function authorPlatformSignInReturnPath(request: NextRequest): string {
  const raw = authorReturnPathFromRequest(request);
  const base =
    AUTHOR_BASE_PATH === '/' ? '' : AUTHOR_BASE_PATH.replace(/\/$/, '');
  const payloadLogin = base === '' ? '/admin/login' : `${base}/admin/login`;
  if (raw === payloadLogin) {
    return base === '' ? '/admin' : `${base}/admin`;
  }
  if (raw.startsWith(`${payloadLogin}/`)) {
    return base === '' ? '/admin' : `${base}/admin`;
  }
  const q = raw.indexOf('?');
  if (q !== -1 && raw.slice(0, q) === payloadLogin) {
    return base === '' ? '/admin' : `${base}/admin`;
  }
  return raw;
}

export { buildPlatformSignInUrl } from '@workspace/gateway-auth/site-origin';
