import { GATEWAY_ENTRY_ORIGIN, isGatewayPath } from '@/lib/gateway-config';
import {
  gatewayUpstreamStubResponse,
  isGatewayUpstreamReachable,
  matchGatewayUpstream,
} from '@/lib/gateway-upstream-check';
import { logMutatingRequestInDev } from '@workspace/gateway-auth/dev-mutating-request-log';
import {
  gatewayPlatformMountedPath,
  getGatewayPlatformPath,
} from '@workspace/gateway-auth/gateway-paths';
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH,
  shouldBypassGatewayPasswordRecoveryRedirect,
} from '@workspace/gateway-auth/password-recovery';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PLATFORM_PREFIX = getGatewayPlatformPath();

function corsHeadersForDev(request: NextRequest): Headers {
  const headers = new Headers();
  const requestOrigin = request.headers.get('origin');
  const allowOrigin =
    requestOrigin && requestOrigin.startsWith('http://localhost')
      ? requestOrigin
      : GATEWAY_ENTRY_ORIGIN;

  headers.set('Access-Control-Allow-Origin', allowOrigin);
  headers.set('Vary', 'Origin');
  headers.set(
    'Access-Control-Allow-Methods',
    'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  headers.set(
    'Access-Control-Allow-Headers',
    request.headers.get('access-control-request-headers') ??
      'Content-Type, Authorization, X-Requested-With, X-CSRF-Token, Accept'
  );
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function withCors(request: NextRequest, response: NextResponse): NextResponse {
  corsHeadersForDev(request).forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
}

function respond(request: NextRequest, response: NextResponse): NextResponse {
  logMutatingRequestInDev(request);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const recoveryCookie = request.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value;
  if (recoveryCookie === '1') {
    const updatePasswordPath = gatewayPlatformMountedPath(
      PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH
    );
    const inPlatform =
      pathname === PLATFORM_PREFIX ||
      pathname.startsWith(`${PLATFORM_PREFIX}/`);
    const onRecoveryPath =
      pathname === updatePasswordPath ||
      pathname.startsWith(`${updatePasswordPath}/`);
    const onConfirmPath = pathname.startsWith(
      gatewayPlatformMountedPath('/auth/confirm')
    );
    if (
      inPlatform &&
      !onRecoveryPath &&
      !onConfirmPath &&
      !shouldBypassGatewayPasswordRecoveryRedirect(pathname, PLATFORM_PREFIX)
    ) {
      const url = request.nextUrl.clone();
      url.pathname = updatePasswordPath;
      url.search = '';
      return respond(request, NextResponse.redirect(url));
    }
  }

  if (!isGatewayPath(request.nextUrl.pathname)) {
    return respond(request, NextResponse.next());
  }

  if (process.env.NODE_ENV !== 'development') {
    return respond(request, NextResponse.next());
  }

  if (request.method === 'OPTIONS') {
    return respond(
      request,
      new NextResponse(null, {
        status: 204,
        headers: corsHeadersForDev(request),
      })
    );
  }

  const upstream = matchGatewayUpstream(request.nextUrl.pathname);
  if (upstream) {
    const reachable = await isGatewayUpstreamReachable(upstream);
    if (!reachable) {
      return respond(
        request,
        withCors(request, gatewayUpstreamStubResponse(upstream))
      );
    }
  }

  const response = NextResponse.next();
  return respond(request, withCors(request, response));
}

/**
 * Next.js only accepts static matchers here (no env or template literals).
 * Gateway prefixes are enforced at runtime via `isGatewayPath` (env-aware).
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
