import { ACTIVE_SPACE_QUERY_SLUG } from './active-space.constants';

export type ActiveSpaceMembership = Readonly<{
  space_id: string;
  status: string;
}>;

export type ResolveActiveSpaceResolution =
  | 'none'
  | 'single_auto'
  | 'multi_default'
  | 'from_cookie'
  | 'from_query';

export type ResolveActiveSpaceResult =
  | {
      kind: 'none';
      reason: 'no_memberships';
      resolution: 'none';
    }
  | {
      kind: 'ok';
      spaceId: string;
      resolution: Exclude<
        ResolveActiveSpaceResolution,
        'none' | 'multi_needs_choice'
      >;
    }
  | {
      kind: 'ok';
      spaceId: string;
      resolution: Exclude<ResolveActiveSpaceResolution, 'none'>;
    };

function activeMemberships(
  rows: readonly ActiveSpaceMembership[]
): ActiveSpaceMembership[] {
  return rows.filter((r) => r.status === 'active');
}

/**
 * Pure resolver for active Space from membership rows + optional cookie + optional query slug.
 * Server must still validate slug maps to a space_id the user belongs to.
 */
export function resolveActiveSpaceDecision(input: {
  memberships: readonly ActiveSpaceMembership[];
  cookieSpaceId: string | undefined;
  querySpaceSlug: string | undefined;
  /** space_id for which `slug` matches query (caller resolves slug -> id) */
  queryResolvesToSpaceId: string | undefined;
  /** caller-computed default active space, e.g. oldest active membership/space */
  defaultSpaceId?: string;
}): ResolveActiveSpaceResult {
  const m = activeMemberships(input.memberships);
  if (m.length === 0) {
    return { kind: 'none', reason: 'no_memberships', resolution: 'none' };
  }
  const allowed = new Set(m.map((x) => x.space_id));

  if (
    input.queryResolvesToSpaceId &&
    allowed.has(input.queryResolvesToSpaceId)
  ) {
    return {
      kind: 'ok',
      spaceId: input.queryResolvesToSpaceId,
      resolution: 'from_query',
    };
  }

  if (input.cookieSpaceId && allowed.has(input.cookieSpaceId)) {
    return {
      kind: 'ok',
      spaceId: input.cookieSpaceId,
      resolution: 'from_cookie',
    };
  }

  if (m.length === 1) {
    const only = m[0];
    if (!only) {
      return { kind: 'none', reason: 'no_memberships', resolution: 'none' };
    }
    return {
      kind: 'ok',
      spaceId: only.space_id,
      resolution: 'single_auto',
    };
  }

  if (input.defaultSpaceId && allowed.has(input.defaultSpaceId)) {
    return {
      kind: 'ok',
      spaceId: input.defaultSpaceId,
      resolution: 'multi_default',
    };
  }

  const first = m[0];
  if (!first) {
    return { kind: 'none', reason: 'no_memberships', resolution: 'none' };
  }

  return {
    kind: 'ok',
    spaceId: first.space_id,
    resolution: 'multi_default',
  };
}

/** Read `?space=<slug>` from a URL when present. */
export function readActiveSpaceSlugFromUrl(
  searchParams: URLSearchParams
): string | undefined {
  const v = searchParams.get(ACTIVE_SPACE_QUERY_SLUG)?.trim();
  return v || undefined;
}
