/**
 * Rules for routes that may be served **without** a Supabase session (guest), given
 * `pathWithinAppBasePath` (path inside the app `basePath`, e.g. `/auth/login`, not `/platform/auth/login`).
 *
 * Session presence is still determined in each app via `supabase.auth.getClaims()`; this module only
 * encodes **which paths** skip the sign-in redirect — one policy per shell app, no duplicated string checks.
 */

export type ShellGuestAccessPolicy = {
  /** Allow `/` without a session (e.g. platform home with login form). */
  allowGuestAtRoot: boolean;
  /**
   * Path prefixes allowed for guests (must start with `/`, e.g. `/auth`, `/api`).
   * A path matches if it equals the prefix or starts with `${prefix}/`.
   */
  allowGuestPrefixes: readonly string[];
};

export const PLATFORM_SHELL_GUEST_ACCESS: ShellGuestAccessPolicy = {
  allowGuestAtRoot: true,
  allowGuestPrefixes: ['/auth', '/login', '/invite'],
};

function normalizePathWithinBase(path: string): string {
  if (path === '' || path === '/') {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Returns true if a guest (no session / no `claims`) may access this in-app path without redirect.
 */
export function isShellPathAllowedForGuest(
  pathWithinBase: string,
  policy: ShellGuestAccessPolicy
): boolean {
  const p = normalizePathWithinBase(pathWithinBase);
  if (p === '/') {
    return policy.allowGuestAtRoot;
  }
  return policy.allowGuestPrefixes.some((prefix) => matchesPrefix(p, prefix));
}
