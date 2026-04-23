import { type NextRequest, NextResponse } from 'next/server';

import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';
import { resolvePublicSiteOrigin } from '@workspace/gateway-auth/site-origin';

import { signOutPlatformSession } from './signout.server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = resolvePublicSiteOrigin(request.headers);
  const response = NextResponse.redirect(
    new URL(gatewayPlatformMountedPath('/'), origin),
    302
  );

  await signOutPlatformSession(response.cookies, request.headers);

  return response;
}
