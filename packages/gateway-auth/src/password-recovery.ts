/**
 * Password recovery flow after GoTrue `type=recovery` email links.
 * Cookie name must stay aligned with `apps/web/gateway/nginx-snippet.example.conf` (`map $http_cookie`).
 */

export const PASSWORD_RECOVERY_COOKIE = 'pf_password_recovery_pending';

/** App Router path under Next `basePath` (not the gateway prefix). */
export const PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH = '/auth/update-password';

export function isPasswordRecoveryPending(
  cookieValue: string | undefined
): boolean {
  return cookieValue === '1';
}

export function isRecoveryUpdatePasswordPath(path: string): boolean {
  return (
    path === PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH ||
    path.startsWith(`${PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH}/`)
  );
}

/**
 * Path within the app after stripping `basePath` — skip recovery redirect for Next internals and typical public files.
 */
export function isNextOrPublicAssetPathWithinApp(path: string): boolean {
  return (
    path.startsWith('/_next/') ||
    path === '/favicon.ico' ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(path)
  );
}

export function getCookieValueFromHeader(
  cookieHeader: string | null,
  name: string
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      return rawValue.join('=');
    }
  }
  return undefined;
}

/** True when the client connection is HTTPS (e.g. TLS terminator in front of nginx). */
export function isHttpsFromForwardedHeaders(headers: Headers): boolean {
  const p =
    headers.get('x-forwarded-proto') ?? headers.get('x-forwarded-protocol');
  return p?.split(',')[0]?.trim().toLowerCase() === 'https';
}

/**
 * `Set-Cookie` options for the recovery pending flag. Use `secure: true` behind reverse proxy with
 * `X-Forwarded-Proto: https` (see nginx snippet).
 */
export function recoveryPendingCookieOptions(headers: Headers): {
  path: string;
  sameSite: 'lax';
  secure: boolean;
} {
  return {
    path: '/',
    sameSite: 'lax',
    secure: isHttpsFromForwardedHeaders(headers),
  };
}

/**
 * Gateway/browser pathnames that must not get the recovery redirect (Next assets, static files, confirm flow).
 * Used by `apps/web` dev proxy; production nginx should use the same exclusions (see gateway nginx snippet).
 */
export function shouldBypassGatewayPasswordRecoveryRedirect(
  pathname: string,
  platformPrefix: string
): boolean {
  if (platformPrefix === '/' || platformPrefix === '') {
    return (
      pathname.startsWith('/_next/') ||
      pathname === '/favicon.ico' ||
      /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(pathname)
    );
  }
  if (
    pathname !== platformPrefix &&
    !pathname.startsWith(`${platformPrefix}/`)
  ) {
    return false;
  }
  return (
    pathname.startsWith(`${platformPrefix}/_next/`) ||
    pathname === `${platformPrefix}/favicon.ico` ||
    (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(pathname) &&
      pathname.startsWith(`${platformPrefix}/`))
  );
}
