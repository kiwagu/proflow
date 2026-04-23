import { getGatewayAuthorPath, getGatewayPlatformPath } from './gateway-paths';

/**
 * Routes served by sibling apps on the gateway (not under the platform app `basePath`).
 * `router.push` to the author prefix from platform would incorrectly nest under platform `basePath`.
 */
export function isGatewaySiblingPath(path: string): boolean {
  const author = getGatewayAuthorPath();
  return path === '/' || path === author || path.startsWith(`${author}/`);
}

export function absoluteUrlForGatewayPath(
  origin: string,
  path: string
): string {
  return `${origin.replace(/\/$/, '')}${path}`;
}

/**
 * Maps a gateway `next` value under the platform mount (e.g. `/platform/profile`) to the platform app's internal
 * route (`/profile`). Returns `null` if `next` is not under that mount.
 */
export function platformRouterPathFromGatewayNext(
  nextPath: string
): string | null {
  const platform = getGatewayPlatformPath();
  if (!nextPath.startsWith(platform)) {
    return null;
  }
  if (nextPath === platform || nextPath === `${platform}/`) {
    return '/';
  }
  const rest = nextPath.slice(platform.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}
