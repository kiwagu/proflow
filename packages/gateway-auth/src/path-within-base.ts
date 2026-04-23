/**
 * Strips a Next `basePath` prefix from the request pathname (gateway-prefixed URLs).
 */
export function pathWithinAppBasePath(
  pathname: string,
  basePath: string
): string {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (pathname === base || pathname === `${base}/`) {
    return '/';
  }
  if (!pathname.startsWith(base)) {
    return pathname;
  }
  const rest = pathname.slice(base.length);
  if (rest === '' || rest === '/') {
    return '/';
  }
  return rest.startsWith('/') ? rest : `/${rest}`;
}
