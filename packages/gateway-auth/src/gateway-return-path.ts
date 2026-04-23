import type { NextRequest } from 'next/server';

import { safeNextPath } from './safe-next-path';

/**
 * Full gateway path (pathname + search) for `next=`, e.g. `/platform/profile` or `/author/admin`.
 * Normalizes app-relative paths when Next strips `basePath` from `pathname`.
 */
export function gatewayReturnPathForApp(
  request: NextRequest,
  appBasePath: string
): string {
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  const base = appBasePath.endsWith('/')
    ? appBasePath.slice(0, -1)
    : appBasePath;

  let sitePath: string;
  if (pathname === base || pathname === `${base}/`) {
    sitePath = base;
  } else if (pathname.startsWith(`${base}/`)) {
    sitePath = pathname;
  } else if (pathname.startsWith('/') && !pathname.startsWith('//')) {
    const rest = pathname === '/' ? '' : pathname;
    sitePath = `${base}${rest}`;
  } else {
    sitePath = base;
  }

  const pathOnly = sitePath.split('?')[0] ?? sitePath;
  if (!safeNextPath(pathOnly)) {
    return base;
  }
  if (pathOnly !== base && !pathOnly.startsWith(`${base}/`)) {
    return base;
  }

  if (search && /[<>"\s\\]/.test(search)) {
    return sitePath;
  }
  return `${sitePath}${search}`;
}
