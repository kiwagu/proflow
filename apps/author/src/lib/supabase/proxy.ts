import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import {
  clearCanonicalActiveSpaceCookie,
  setCanonicalActiveSpaceCookie,
} from '@workspace/gateway-auth/active-space.cookie';
import type { Database } from '@workspace/db';
import { hasSupabaseShellEnv } from '@workspace/gateway-auth/env';
import { getAppBasePath } from '@workspace/gateway-auth/gateway-paths';
import { pathWithinAppBasePath } from '@workspace/gateway-auth/path-within-base';
import { isNextOrPublicAssetPathWithinApp } from '@workspace/gateway-auth/password-recovery';
import {
  AUTHOR_SHELL_GUEST_ACCESS,
  isShellPathAllowedForGuest,
} from '@workspace/gateway-auth/shell-guest-access';
import { resolvePublicSiteOrigin } from '@workspace/gateway-auth/site-origin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import {
  authorPlatformSignInReturnPath,
  buildPlatformSignInUrl,
} from '@/lib/auth-redirect';

const AUTHOR_BASE = getAppBasePath('/author');

/** Payload default cookie prefix is `payload`; token cookie = `{prefix}-token`. */
const PAYLOAD_TOKEN_COOKIE = 'payload-token';
const PAYLOAD_TENANT_COOKIE = 'payload-tenant';
const PAYLOAD_TENANT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type PayloadTenantSync =
  { kind: 'none' } | { kind: 'clear' } | { kind: 'set'; value: string };

type ActiveSpaceOptions = {
  activeSpaceIds: Set<string>;
  defaultSpaceId?: string;
};

/**
 * Reads the user's active memberships for the per-request tenant-cookie sync.
 * Returns NULL when the read FAILS (transient DB/REST error) — the caller must
 * then keep the cookies untouched ('none'), never 'clear' them: silently
 * treating a failed read as "zero memberships" DELETED the canonical
 * active-space cookies on a hiccup (the author-space-sync drift).
 */
async function loadActiveSpaceOptions(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ActiveSpaceOptions | null> {
  const { data: membershipRows, error } = await supabase
    .from('space_memberships')
    .select('space_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    return null;
  }

  const activeSpaceIds =
    membershipRows
      ?.map((row) => row.space_id)
      .filter((spaceId): spaceId is string => Boolean(spaceId)) ?? [];
  if (activeSpaceIds.length === 0) {
    return { activeSpaceIds: new Set(), defaultSpaceId: undefined };
  }

  const { data: spaces } = await supabase
    .from('spaces')
    .select('id')
    .in('id', activeSpaceIds)
    .order('created_at', { ascending: true })
    .limit(1);

  return {
    activeSpaceIds: new Set(activeSpaceIds),
    defaultSpaceId: spaces?.[0]?.id,
  };
}

function resolvePayloadTenantSync(input: {
  activeSpaceId?: string;
  payloadTenantId?: string;
  userPresent: boolean;
  activeSpaceIds: ReadonlySet<string>;
  defaultSpaceId?: string;
}): PayloadTenantSync {
  const {
    activeSpaceId,
    payloadTenantId,
    userPresent,
    activeSpaceIds,
    defaultSpaceId,
  } = input;

  if (!userPresent) {
    return payloadTenantId ? { kind: 'clear' } : { kind: 'none' };
  }

  // Re-stamping a value BOTH cookies already carry is not a no-op: every author
  // response would then Set-Cookie the REQUEST-time state, and a slow response
  // landing AFTER a concurrent platform-side space switch would overwrite the
  // fresh choice with the stale one (Set-Cookie applies jar-wide even for an
  // unloaded page). Only stamp when something actually changes.
  const settle = (value: string): PayloadTenantSync =>
    value === activeSpaceId && value === payloadTenantId
      ? { kind: 'none' }
      : { kind: 'set', value };

  if (activeSpaceId && activeSpaceIds.has(activeSpaceId)) {
    return settle(activeSpaceId);
  }

  if (payloadTenantId && activeSpaceIds.has(payloadTenantId)) {
    return settle(payloadTenantId);
  }

  if (defaultSpaceId && activeSpaceIds.has(defaultSpaceId)) {
    return settle(defaultSpaceId);
  }

  return activeSpaceId || payloadTenantId
    ? { kind: 'clear' }
    : { kind: 'none' };
}

function isPrefetchOrDataRequest(request: NextRequest): boolean {
  const purpose = request.headers.get('purpose');
  const nextData = request.headers.get('x-nextjs-data');
  return purpose === 'prefetch' || nextData === '1';
}

function applyPayloadTenantSyncToRequest(
  request: NextRequest,
  sync: PayloadTenantSync
) {
  if (sync.kind === 'set') {
    request.cookies.set(PAYLOAD_TENANT_COOKIE, sync.value);
    request.cookies.set(ACTIVE_SPACE_COOKIE, sync.value);
    return;
  }

  if (sync.kind === 'clear') {
    request.cookies.set(PAYLOAD_TENANT_COOKIE, '');
    request.cookies.set(ACTIVE_SPACE_COOKIE, '');
  }
}

function applyPayloadTenantSyncToResponse(
  response: NextResponse,
  sync: PayloadTenantSync,
  request?: NextRequest
): NextResponse {
  if (sync.kind === 'none') {
    return response;
  }

  const isPrefetch = request && isPrefetchOrDataRequest(request);

  if (sync.kind === 'set') {
    response.cookies.set(PAYLOAD_TENANT_COOKIE, sync.value, {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: PAYLOAD_TENANT_MAX_AGE_SECONDS,
    });
    if (!isPrefetch) {
      setCanonicalActiveSpaceCookie(response.cookies, sync.value);
    }
    return response;
  }

  response.cookies.set(PAYLOAD_TENANT_COOKIE, '', {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  if (!isPrefetch) {
    clearCanonicalActiveSpaceCookie(response.cookies);
  }
  return response;
}

function gatewayBase(): string {
  return AUTHOR_BASE === '/' ? '' : AUTHOR_BASE.replace(/\/$/, '');
}

function platformLoginResponse(
  request: NextRequest,
  sync: PayloadTenantSync
): NextResponse {
  const returnPath = authorPlatformSignInReturnPath(request);
  const url = buildPlatformSignInUrl(returnPath, request.headers);
  return applyPayloadTenantSyncToResponse(
    NextResponse.redirect(url, 307),
    sync,
    request
  );
}

/** Payload's email/password admin login — not used when Supabase is the IdP. */
function isPayloadNativeAdminLoginPath(path: string): boolean {
  return path === '/admin/login' || path.startsWith('/admin/login/');
}

function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

/**
 * The dedicated document editor (`/author/doc/[nodeId]`). Like `/admin/*` it mounts
 * Payload's editor — whose server-function REQUIRES a Payload user — so it needs the
 * `payload-token` cookie, NOT just the Supabase session (unlike `/graph/*`, which is
 * RLS-only). It must therefore go through the same Payload session bridge.
 */
function isDocEditorPath(path: string): boolean {
  return path === '/doc' || path.startsWith('/doc/');
}

/**
 * Graph endpoints (`/author/graph/*`, slice-03 §5.1). A SEPARATE auth context
 * from `/admin/*`: they require the SUPABASE session (cookies) and build a
 * Postgres-RLS client inside the handler — Postgres RLS is the sole authority.
 * They are deliberately NOT Payload `/api` (so they never inherit the `/api`
 * guest exception) and NOT `/admin/*` (so they never demand a `payload-token`).
 * A guest reaching them falls through to the platform sign-in redirect below,
 * exactly like any other authenticated path.
 */
function isGraphPath(path: string): boolean {
  return path === '/graph' || path.startsWith('/graph/');
}

/**
 * Builds a 307 to the Payload session bridge, which issues a Payload JWT cookie and then
 * redirects to `nextAdminPath` (e.g. `/admin` or `/admin/collections/users`).
 */
function payloadBridgeRedirect(
  request: NextRequest,
  nextAdminPath: string,
  sync: PayloadTenantSync
): NextResponse {
  const origin = resolvePublicSiteOrigin(request.headers);
  const base = gatewayBase();
  const qs = new URLSearchParams({ next: nextAdminPath });
  return applyPayloadTenantSyncToResponse(
    NextResponse.redirect(
      new URL(`${base}/api/auth/admin-payload-bridge?${qs}`, origin),
      307
    ),
    sync,
    request
  );
}

/**
 * Refreshes the Supabase session from cookies (same pattern as `apps/platform`).
 *
 * Redirect priority (all server-side 307, no client hops):
 * 1. No Supabase session + authenticated path → platform sign-in
 * 2. Supabase session + admin path + no Payload cookie → bridge (issues JWT + 307 to target)
 * 3. `/` + session → `/author/admin`
 * 4. `/admin/login` → never rendered: guests → platform (`next=` avoids `/admin/login`); signed-in → bridge to `/admin`
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  if (process.env.AUTHOR_E2E_BYPASS_SUPABASE_PROXY === '1') {
    return supabaseResponse;
  }

  if (!hasSupabaseShellEnv) {
    return supabaseResponse;
  }

  const path = pathWithinAppBasePath(request.nextUrl.pathname, AUTHOR_BASE);
  if (isNextOrPublicAssetPathWithinApp(path)) {
    return supabaseResponse;
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
  const activeSpaceId = request.cookies.get(ACTIVE_SPACE_COOKIE)?.value?.trim();
  const payloadTenantId = request.cookies
    .get(PAYLOAD_TENANT_COOKIE)
    ?.value?.trim();
  const activeSpaceOptions = user
    ? await loadActiveSpaceOptions(supabase, user.sub)
    : { activeSpaceIds: new Set<string>(), defaultSpaceId: undefined };
  // A FAILED membership read (null) is not "no memberships": keep the cookies
  // exactly as they are ('none') — clearing canonical state on a transient
  // error is how the active-space drift snuck in.
  const payloadTenantSync: PayloadTenantSync =
    activeSpaceOptions === null
      ? { kind: 'none' }
      : resolvePayloadTenantSync({
          activeSpaceId,
          payloadTenantId,
          userPresent: Boolean(user),
          activeSpaceIds: activeSpaceOptions.activeSpaceIds,
          defaultSpaceId: activeSpaceOptions.defaultSpaceId,
        });

  applyPayloadTenantSyncToRequest(request, payloadTenantSync);
  applyPayloadTenantSyncToResponse(
    supabaseResponse,
    payloadTenantSync,
    request
  );

  if (isPayloadNativeAdminLoginPath(path)) {
    if (!user) {
      return applyPayloadTenantSyncToResponse(
        NextResponse.redirect(
          buildPlatformSignInUrl(
            authorPlatformSignInReturnPath(request),
            request.headers
          ),
          307
        ),
        payloadTenantSync,
        request
      );
    }
    return payloadBridgeRedirect(request, '/admin', payloadTenantSync);
  }

  // Graph paths: Supabase session required, NEVER payload-token. A session-bearing
  // request passes straight to the handler/page, which builds the user's RLS
  // client and lets Postgres RLS decide (slice-03 §5.1 / slice-04 §5). A guest is
  // refused by FORM of request: render pages are GET navigations → redirect to
  // platform sign-in (a raw JSON 401 would break the page UX); the slice-03
  // fan-out endpoints are POST → keep the clean 401 JSON. `method` is the cleanest
  // signal and avoids coupling to specific sub-paths (§5.1 decision 5).
  if (isGraphPath(path)) {
    if (!user) {
      if (request.method === 'GET') {
        return platformLoginResponse(request, payloadTenantSync);
      }
      return applyPayloadTenantSyncToResponse(
        NextResponse.json({ message: 'Not authenticated.' }, { status: 401 }),
        payloadTenantSync,
        request
      );
    }
    return supabaseResponse;
  }

  if (!user && !isShellPathAllowedForGuest(path, AUTHOR_SHELL_GUEST_ACCESS)) {
    return platformLoginResponse(request, payloadTenantSync);
  }

  if (path === '/' && user) {
    const adminUrl = new URL(
      `${gatewayBase()}/admin`,
      resolvePublicSiteOrigin(request.headers)
    );
    adminUrl.search = request.nextUrl.search;
    return applyPayloadTenantSyncToResponse(
      NextResponse.redirect(adminUrl, 307),
      payloadTenantSync,
      request
    );
  }

  if (
    user &&
    (isAdminPath(path) || isDocEditorPath(path)) &&
    !request.cookies.get(PAYLOAD_TOKEN_COOKIE)
  ) {
    // The editor's seed choice rides in the query (`?source=`/`?version=`), so
    // the bridge must return to the FULL path+search — otherwise the choice is
    // dropped and the editor falls back to the latest draft.
    const target = isDocEditorPath(path)
      ? `${path}${request.nextUrl.search}`
      : path;
    return payloadBridgeRedirect(request, target, payloadTenantSync);
  }

  return supabaseResponse;
}
