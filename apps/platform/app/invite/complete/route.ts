import { type NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';
import { resolvePublicSiteOrigin } from '@workspace/gateway-auth/site-origin';

import {
  acceptSpaceInviteForSession,
  setActiveSpaceCookieForInvite,
} from '@/lib/space-invite.accept.server';

function redirectTo(request: NextRequest, path: string): NextResponse {
  const origin = resolvePublicSiteOrigin(request.headers);
  return NextResponse.redirect(
    new URL(gatewayPlatformMountedPath(path), origin),
    302
  );
}

/**
 * Finalises a Space invite: accepts the invite, sets the active-space cookie,
 * and redirects to `/profile`. Runs entirely server-side (Route Handler) so
 * cookies can be mutated and no intermediate UI is rendered.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('t')?.trim() ?? '';
  if (!token) {
    return redirectTo(request, '/invite/error?reason=missing_token');
  }

  const result = await acceptSpaceInviteForSession(token);

  if (result.status === 'unauthenticated') {
    return redirectTo(request, '/invite/error?reason=session_expired');
  }

  if (result.status === 'error') {
    const reason = encodeURIComponent(result.message);
    return redirectTo(
      request,
      `/invite/error?reason=accept_failed&detail=${reason}`
    );
  }

  await setActiveSpaceCookieForInvite(result.spaceId);
  revalidatePath('/profile');
  revalidatePath('/organizations');
  revalidatePath('/');
  return redirectTo(request, '/profile');
}
