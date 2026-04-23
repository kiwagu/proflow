import { hasSupabaseShellEnv } from '@workspace/gateway-auth/env';
import type { Database } from '@workspace/db';
import { safeNextPath } from '@workspace/gateway-auth/safe-next-path';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import {
  authorReturnPathFromRequest,
  buildPlatformSignInUrl,
} from '@/lib/auth-redirect';
import { establishPayloadSessionFromAccessToken } from '@/lib/establish-payload-session-from-access-token';
import { resolvePublicSiteOrigin } from '@workspace/gateway-auth/site-origin';

function resolvePostLoginAppPath(raw: string | null): string {
  const d = safeNextPath(raw) ?? '/admin';
  if (d === '/admin' || d.startsWith('/admin/')) {
    return d;
  }
  return '/admin';
}

function absoluteAuthorUrl(request: NextRequest, appRelativePath: string): URL {
  const p = appRelativePath.startsWith('/')
    ? appRelativePath
    : `/${appRelativePath}`;
  const base = AUTHOR_BASE_PATH.replace(/\/$/, '');
  const pathname =
    !base || base === '/' ? p : `${base}${p === '/' && base ? '' : p}`;
  // `request.nextUrl.origin` follows the author dev port (3002) behind apps/web rewrites; use the
  // public gateway origin so 307 Location keeps the browser on :3000.
  return new URL(pathname || '/', resolvePublicSiteOrigin(request.headers));
}

function applyPendingCookies(
  response: NextResponse,
  pending: ReadonlyArray<{
    name: string;
    value: string;
    options?: CookieOptions;
  }>
): void {
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
}

/**
 * Sets Payload admin cookie from Supabase session, then 307 to `next` (or `/admin`).
 * The author proxy redirects here when Supabase session exists but no Payload cookie is present,
 * keeping the entire auth chain as server-side 307 redirects with zero client-side hops.
 */
export async function GET(request: NextRequest) {
  const pendingCookies: {
    name: string;
    value: string;
    options?: CookieOptions;
  }[] = [];

  if (!hasSupabaseShellEnv) {
    const dest = absoluteAuthorUrl(request, '/admin');
    return NextResponse.redirect(dest, 307);
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          pendingCookies.push(...cookiesToSet);
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const nextTarget = resolvePostLoginAppPath(
    request.nextUrl.searchParams.get('next') ??
      request.nextUrl.searchParams.get('redirect')
  );

  const redirectToPlatform = () => {
    const r = NextResponse.redirect(
      buildPlatformSignInUrl(
        authorReturnPathFromRequest(request),
        request.headers
      ),
      307
    );
    applyPendingCookies(r, pendingCookies);
    return r;
  };

  if (!session?.access_token) {
    return redirectToPlatform();
  }

  const established = await establishPayloadSessionFromAccessToken(
    session.access_token,
    request
  );

  if (!established.ok) {
    return redirectToPlatform();
  }

  const r = NextResponse.redirect(absoluteAuthorUrl(request, nextTarget), 307);
  applyPendingCookies(r, pendingCookies);
  r.headers.append('Set-Cookie', established.setCookieHeader);
  return r;
}
