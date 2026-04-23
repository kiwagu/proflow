import { type EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  gatewayPlatformMountedPath,
  getGatewayPlatformPath,
} from '@workspace/gateway-auth/gateway-paths';
import { recoveryPendingCookieOptions } from '@workspace/gateway-auth/password-recovery';
import {
  absoluteUrlForGatewayPath,
  isGatewaySiblingPath,
  platformRouterPathFromGatewayNext,
} from '@workspace/gateway-auth/post-auth-navigation';
import { resolvedNextPath } from '@workspace/gateway-auth/safe-next-path';
import { resolvePublicSiteOrigin } from '@workspace/gateway-auth/site-origin';

import { createClient } from '@/lib/supabase/server';
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH,
} from '@workspace/gateway-auth/password-recovery';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const platformMount = getGatewayPlatformPath();
  const path = resolvedNextPath(searchParams.get('next'), platformMount);
  const origin = resolvePublicSiteOrigin(request.headers);

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      if (type === 'recovery') {
        const url = new URL(
          gatewayPlatformMountedPath(PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH),
          origin
        );
        const response = NextResponse.redirect(url);
        response.cookies.set(PASSWORD_RECOVERY_COOKIE, '1', {
          ...recoveryPendingCookieOptions(request.headers),
        });
        return response;
      }
      const platformInternal = platformRouterPathFromGatewayNext(path);
      if (platformInternal !== null) {
        return NextResponse.redirect(
          new URL(gatewayPlatformMountedPath(platformInternal), origin)
        );
      }
      if (isGatewaySiblingPath(path)) {
        return NextResponse.redirect(
          new URL(absoluteUrlForGatewayPath(origin, path))
        );
      }
      return NextResponse.redirect(new URL(path, origin));
    } else {
      if (type === 'recovery') {
        await supabase.auth.signOut();
      }
      const errMsg = error?.message ?? 'Verification failed';
      const response = NextResponse.redirect(
        new URL(
          `${gatewayPlatformMountedPath('/auth/error')}?error=${encodeURIComponent(errMsg)}`,
          origin
        )
      );
      if (type === 'recovery') {
        response.cookies.set(PASSWORD_RECOVERY_COOKIE, '', {
          ...recoveryPendingCookieOptions(request.headers),
          maxAge: 0,
        });
      }
      return response;
    }
  }

  return NextResponse.redirect(
    new URL(
      `${gatewayPlatformMountedPath('/auth/error')}?error=${encodeURIComponent('No token hash or type')}`,
      origin
    )
  );
}
