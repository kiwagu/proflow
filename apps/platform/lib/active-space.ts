import type { Database } from '@workspace/db';
import {
  ACTIVE_SPACE_COOKIE,
  ACTIVE_SPACE_QUERY_SLUG,
} from '@workspace/gateway-auth/active-space.constants';
import {
  readCanonicalActiveSpaceIdFromCookies,
  setCanonicalActiveSpaceCookie,
} from '@workspace/gateway-auth/active-space.cookie';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';
import { PLATFORM_OPERATOR_CONSOLE_PATH } from '@/lib/platform-routes';
import {
  readActiveSpaceSlugFromUrl,
  resolveActiveSpaceDecision,
  type ActiveSpaceMembership,
} from '@workspace/gateway-auth/resolve-active-space';
import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';
import { resolvePublicSiteOrigin } from '@workspace/gateway-auth/site-origin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

export { ACTIVE_SPACE_COOKIE, ACTIVE_SPACE_QUERY_SLUG };

export type AccessibleSpaceOption = {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  organizationId: string;
  createdAt: string | null;
};

/** Cookie store interface compatible with both `request.cookies` (middleware) and `await cookies()` (server components). */
interface CookieStore {
  get(name: string): { value: string } | undefined;
}

/** Reads the active space ID from any cookie store. */
export function readActiveSpaceIdFromCookies(
  store: CookieStore
): string | null {
  return readCanonicalActiveSpaceIdFromCookies(store);
}

/**
 * Paths under the app base path that skip active-space resolution (onboarding, picker, APIs).
 *
 * - Account routes (`/profile`, …) for users who already have an organization (no org yet → `/onboarding`).
 * - App root `/` sends signed-in users to `/profile` or `/onboarding` when they still need org bootstrap.
 */
export function shouldSkipActiveSpaceResolution(
  pathWithinBase: string
): boolean {
  const p = pathWithinBase === '' ? '/' : pathWithinBase;
  if (p === '/') return true;
  if (p.startsWith('/auth') || p.startsWith('/login')) return true;
  if (p.startsWith('/api')) return true;
  if (p.startsWith('/onboarding')) return true;
  if (p === '/profile' || p.startsWith('/profile/')) return true;
  if (p === '/organizations' || p.startsWith('/organizations/')) return true;
  if (
    p === PLATFORM_OPERATOR_CONSOLE_PATH ||
    p.startsWith(`${PLATFORM_OPERATOR_CONSOLE_PATH}/`)
  ) {
    return true;
  }
  if (p === '/invite' || p.startsWith('/invite/')) return true;
  return false;
}

export function resolveActiveSpaceIdForAccessibleSpaces(
  spaces: readonly AccessibleSpaceOption[],
  cookieActiveSpaceId: string | null
): string | null {
  if (spaces.length === 0) {
    return null;
  }

  if (cookieActiveSpaceId) {
    const allowedIds = new Set(spaces.map((space) => space.id));
    if (allowedIds.has(cookieActiveSpaceId)) {
      return cookieActiveSpaceId;
    }
  }

  return spaces[0]?.id ?? null;
}

function sortSpacesForSuperAdminFallback(
  spaces: readonly AccessibleSpaceOption[],
  memberSpaceIds: ReadonlySet<string>
): AccessibleSpaceOption[] {
  if (spaces.length <= 1 || memberSpaceIds.size === 0) {
    return [...spaces];
  }

  return [...spaces].sort((left, right) => {
    const leftRank = memberSpaceIds.has(left.id) ? 0 : 1;
    const rightRank = memberSpaceIds.has(right.id) ? 0 : 1;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftCreatedAt = left.createdAt ?? '';
    const rightCreatedAt = right.createdAt ?? '';
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt.localeCompare(rightCreatedAt);
    }

    return left.name.localeCompare(right.name);
  });
}

function toActiveSpaceMemberships(
  spaces: readonly AccessibleSpaceOption[]
): ActiveSpaceMembership[] {
  return spaces.map((space) => ({
    space_id: space.id,
    status: 'active',
  }));
}

export async function listAccessibleSpacesForUser(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{
  isSuperAdmin: boolean;
  spaces: AccessibleSpaceOption[];
}> {
  const isSuperAdmin = await hasCriticalCapability(
    supabase,
    CRITICAL_CAPABILITY_KEYS.platformAdminOverride
  );

  if (isSuperAdmin) {
    const [spaceRowsResult, membershipRowsResult] = await Promise.all([
      supabase
        .from('spaces')
        .select('id,name,slug,avatar_url,organization_id,created_at')
        .order('created_at', { ascending: true }),
      supabase
        .from('space_memberships')
        .select('space_id')
        .eq('user_id', userId)
        .eq('status', 'active'),
    ]);

    const { data: spaceRows, error } = spaceRowsResult;

    if (error || !spaceRows?.length) {
      return { isSuperAdmin, spaces: [] };
    }

    const memberSpaceIds = new Set(
      (membershipRowsResult.data ?? []).map((row) => row.space_id)
    );

    const orderedSpaces = sortSpacesForSuperAdminFallback(
      spaceRows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        avatarUrl: row.avatar_url,
        organizationId: row.organization_id,
        createdAt: row.created_at,
      })),
      memberSpaceIds
    );

    return {
      isSuperAdmin,
      spaces: orderedSpaces,
    };
  }

  const { data: memRows, error: memErr } = await supabase
    .from('space_memberships')
    .select('space_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (memErr || !memRows?.length) {
    return { isSuperAdmin, spaces: [] };
  }

  const ids = [...new Set(memRows.map((membership) => membership.space_id))];
  const { data: spaceRows, error } = await supabase
    .from('spaces')
    .select('id,name,slug,avatar_url,organization_id,created_at')
    .in('id', ids)
    .order('created_at', { ascending: true });

  if (error || !spaceRows?.length) {
    return { isSuperAdmin, spaces: [] };
  }

  return {
    isSuperAdmin,
    spaces: spaceRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      avatarUrl: row.avatar_url,
      organizationId: row.organization_id,
      createdAt: row.created_at,
    })),
  };
}

function resolveQuerySlugToSpaceId(
  memberships: readonly ActiveSpaceMembership[],
  slugBySpaceId: ReadonlyMap<string, string>,
  slug: string | undefined
): string | undefined {
  if (!slug) return undefined;
  const allowed = new Set(
    memberships.filter((m) => m.status === 'active').map((m) => m.space_id)
  );
  for (const [spaceId, s] of slugBySpaceId) {
    if (!allowed.has(spaceId)) continue;
    if (s === slug) return spaceId;
  }
  return undefined;
}

async function loadMembershipsWithSlugs(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{
  memberships: ActiveSpaceMembership[];
  slugBySpaceId: Map<string, string>;
  defaultSpaceId?: string;
}> {
  const { spaces } = await listAccessibleSpacesForUser(supabase, userId);

  if (!spaces.length) {
    return {
      memberships: [],
      slugBySpaceId: new Map(),
      defaultSpaceId: undefined,
    };
  }

  const slugBySpaceId = new Map<string, string>();
  for (const space of spaces) {
    slugBySpaceId.set(space.id, space.slug);
  }
  const memberships = toActiveSpaceMemberships(spaces);
  const defaultSpaceId = spaces[0]?.id;

  return { memberships, slugBySpaceId, defaultSpaceId };
}

function isPrefetchOrDataRequest(request: NextRequest): boolean {
  const purpose = request.headers.get('purpose');
  const nextData = request.headers.get('x-nextjs-data');
  return purpose === 'prefetch' || nextData === '1';
}

export async function applyActiveSpaceGate(input: {
  request: NextRequest;
  pathWithinBase: string;
  supabase: SupabaseClient<Database>;
  supabaseResponse: NextResponse;
}): Promise<NextResponse> {
  const { request, pathWithinBase, supabase, supabaseResponse } = input;

  if (shouldSkipActiveSpaceResolution(pathWithinBase)) {
    return supabaseResponse;
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return supabaseResponse;
  }

  const uid = userData.user.id;

  const { memberships, slugBySpaceId, defaultSpaceId } =
    await loadMembershipsWithSlugs(supabase, uid);

  const slug = readActiveSpaceSlugFromUrl(request.nextUrl.searchParams);
  const queryResolvesToSpaceId = resolveQuerySlugToSpaceId(
    memberships,
    slugBySpaceId,
    slug
  );

  const cookieSpaceId =
    readActiveSpaceIdFromCookies(request.cookies) ?? undefined;

  const decision = resolveActiveSpaceDecision({
    memberships,
    cookieSpaceId,
    querySpaceSlug: slug,
    queryResolvesToSpaceId,
    defaultSpaceId,
  });

  if (decision.kind === 'none') {
    const email = userData.user.email?.trim().toLowerCase() ?? '';
    const { count: orgCount, error: orgErr } = await supabase
      .from('organization_memberships')
      .select('organization_id', { count: 'exact', head: true })
      .eq('user_id', uid);

    if (!orgErr && (orgCount ?? 0) > 0) {
      const dest = new URL(
        gatewayPlatformMountedPath('/profile'),
        resolvePublicSiteOrigin(request.headers)
      );
      return NextResponse.redirect(dest);
    }

    if (email.length > 0) {
      const { count: inviteCount, error: inviteErr } = await supabase
        .from('space_invites')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('email', email);

      if (!inviteErr && (inviteCount ?? 0) > 0) {
        const dest = new URL(
          gatewayPlatformMountedPath('/profile'),
          resolvePublicSiteOrigin(request.headers)
        );
        return NextResponse.redirect(dest);
      }
    }

    const dest = new URL(
      gatewayPlatformMountedPath('/onboarding'),
      resolvePublicSiteOrigin(request.headers)
    );
    return NextResponse.redirect(dest);
  }

  if (decision.resolution === 'from_query') {
    if (isPrefetchOrDataRequest(request)) {
      return supabaseResponse;
    }
    const nextUrl = new URL(request.url);
    nextUrl.searchParams.delete(ACTIVE_SPACE_QUERY_SLUG);
    const res = NextResponse.redirect(nextUrl);
    setCanonicalActiveSpaceCookie(res.cookies, decision.spaceId);
    return res;
  }

  if (!isPrefetchOrDataRequest(request)) {
    setCanonicalActiveSpaceCookie(supabaseResponse.cookies, decision.spaceId);
  }
  return supabaseResponse;
}
