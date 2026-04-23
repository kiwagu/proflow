import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';

/**
 * Gateway-mounted path + query: creates Auth user (if needed) and magic-link session, then completes invite.
 * Use for links shared by email or copy-to-clipboard from the org UI.
 */
export function gatewaySpaceInviteStartPathWithQuery(token: string): string {
  const base = gatewayPlatformMountedPath('/invite/start');
  const q = new URLSearchParams({ t: token.trim() });
  return `${base}?${q.toString()}`;
}

/**
 * Full URL for clipboard in the browser (origin + gateway path).
 */
export function absoluteSpaceInviteStartUrl(token: string): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return `${window.location.origin}${gatewaySpaceInviteStartPathWithQuery(token)}`;
}
