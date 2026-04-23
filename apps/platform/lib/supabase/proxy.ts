import type { Database } from '@workspace/db';
import { hasSupabaseShellEnv } from '@workspace/gateway-auth/env';
import {
  gatewayPlatformMountedPath,
  getAppBasePath,
} from '@workspace/gateway-auth/gateway-paths';
import { gatewayReturnPathForApp } from '@workspace/gateway-auth/gateway-return-path';
import { pathWithinAppBasePath } from '@workspace/gateway-auth/path-within-base';
import {
  getCookieValueFromHeader,
  isNextOrPublicAssetPathWithinApp,
  isPasswordRecoveryPending,
  isRecoveryUpdatePasswordPath,
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH,
} from '@workspace/gateway-auth/password-recovery';
import {
  isShellPathAllowedForGuest,
  PLATFORM_SHELL_GUEST_ACCESS,
} from '@workspace/gateway-auth/shell-guest-access';
import { applyActiveSpaceGate } from '@/lib/active-space';
import {
  buildPlatformSignInUrl,
  resolvePublicSiteOrigin,
} from '@workspace/gateway-auth/site-origin';
import {
  PLATFORM_LOCALE_COOKIE,
  resolvePlatformLocaleFromAcceptLanguage,
} from '@workspace/settings-runtime';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PLATFORM_BASE = getAppBasePath('/platform');

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  if (!hasSupabaseShellEnv) {
    ensureLocaleCookieFromAcceptLanguage(request, supabaseResponse);
    return supabaseResponse;
  }

  const path = pathWithinAppBasePath(request.nextUrl.pathname, PLATFORM_BASE);
  if (isNextOrPublicAssetPathWithinApp(path)) {
    ensureLocaleCookieFromAcceptLanguage(request, supabaseResponse);
    return supabaseResponse;
  }

  const recoveryCookie =
    request.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value ??
    getCookieValueFromHeader(
      request.headers.get('cookie'),
      PASSWORD_RECOVERY_COOKIE
    );
  const recoveryPending = isPasswordRecoveryPending(recoveryCookie);
  // Enforce recovery flow before any auth/session resolution to avoid UI blink.
  if (
    recoveryPending &&
    !isRecoveryUpdatePasswordPath(path) &&
    !path.startsWith('/auth/confirm')
  ) {
    const dest = new URL(
      gatewayPlatformMountedPath(PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH),
      resolvePublicSiteOrigin(request.headers)
    );
    return NextResponse.redirect(dest);
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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user && !isShellPathAllowedForGuest(path, PLATFORM_SHELL_GUEST_ACCESS)) {
    const returnPath = gatewayReturnPathForApp(request, PLATFORM_BASE);
    const url = buildPlatformSignInUrl(returnPath, request.headers);
    return NextResponse.redirect(url);
  }

  ensureLocaleCookieFromAcceptLanguage(request, supabaseResponse);

  if (user) {
    return applyActiveSpaceGate({
      request,
      pathWithinBase: path,
      supabase,
      supabaseResponse,
    });
  }

  return supabaseResponse;
}

function ensureLocaleCookieFromAcceptLanguage(
  request: NextRequest,
  response: NextResponse
) {
  const existing = request.cookies.get(PLATFORM_LOCALE_COOKIE)?.value;
  if (existing) {
    return;
  }

  const resolved = resolvePlatformLocaleFromAcceptLanguage(
    request.headers.get('accept-language')
  );

  response.cookies.set(PLATFORM_LOCALE_COOKIE, resolved, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
