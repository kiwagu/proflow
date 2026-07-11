import { entityIds } from '@workspace/entity-id';
import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  grantResourceToUser,
  linkResourceScope,
  listGrantableMembers,
  listScopeChoices,
  listUserGrants,
  loadResourceFloor,
  revokeResourceUserGrant,
  setResourceFloor,
  unlinkResourceScope,
} from '@/knowledge/fanout';

/**
 * Resource visibility / sharing — ONE endpoint, ONE Share dialog.
 * Serves the whole audience of a node: the broadcast floor + cohort grants + per-user
 * grants.
 *
 * GET    — the node's current floor (`visibility`), the space's cohort scopes (with
 *          whether this node is granted to each), the node's per-user `grants`, and the
 *          grantable `members` picker source.
 * PATCH  — set the broadcast floor (publish private→space, or restrict space→private).
 * POST   — grant access: a cohort (`{ resourceId, scopeId }`) OR one person
 *          (`{ resourceId, userId }`) — discriminated on `grantType`.
 * DELETE — remove a grant: a cohort OR one person — symmetric to POST.
 *
 * Auth context: the Supabase SESSION under `/author/graph/*`. Postgres RLS is the SOLE
 * authority: cohort link/unlink gate on `space.knowledge.access`; the floor change and
 * per-user grant/revoke are owner-sovereign (owner OR `space.knowledge.access`).
 * `linked_by` / `granted_by` come from the SESSION, never the body. Zero service-role.
 * THIN transport.
 */

export const dynamic = 'force-dynamic';

/** Optional people-picker search term: trimmed, blank → bounded starter list.
 * The directory function caps the result server-side regardless of this param. */
const memberQuerySchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/** Optional opaque keyset cursor: the directory's `p_after` position of the
 * last seen row. Trimmed; blank → first page. Opaque to this layer — the fanout decodes it;
 * a malformed token fails soft to first page (the membership fence is the authority). */
const memberCursorSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/** Optional page-size hint: the picker pages 5 by default. Clamped to ≤50
 * defensively here; the directory function clamps server-side regardless. */
const memberLimitSchema = z.coerce.number().int().min(1).max(50).optional();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const spaceId = url.searchParams.get('space_id')?.trim();
  const nodeId = url.searchParams.get('node_id')?.trim();
  if (!spaceId || !nodeId) {
    return NextResponse.json(
      { message: 'space_id and node_id are required.' },
      { status: 400 }
    );
  }
  const queryParsed = memberQuerySchema.safeParse(
    url.searchParams.get('q') ?? undefined
  );
  const cursorParsed = memberCursorSchema.safeParse(
    url.searchParams.get('cursor') ?? undefined
  );
  const limitParsed = memberLimitSchema.safeParse(
    url.searchParams.get('limit') ?? undefined
  );
  if (!queryParsed.success || !cursorParsed.success || !limitParsed.success) {
    const issues = [
      ...(queryParsed.success ? [] : queryParsed.error.issues),
      ...(cursorParsed.success ? [] : cursorParsed.error.issues),
      ...(limitParsed.success ? [] : limitParsed.error.issues),
    ];
    return NextResponse.json(
      { message: 'Invalid request', issues },
      { status: 400 }
    );
  }
  const memberQuery = queryParsed.data;
  const memberCursor = cursorParsed.data;
  const memberLimit = limitParsed.data;

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }

  try {
    const [choices, floor, grants, members] = await Promise.all([
      listScopeChoices({ spaceId, nodeId }, { db: session.db }),
      loadResourceFloor({ nodeId }, { db: session.db }),
      listUserGrants({ resourceId: nodeId }, { db: session.db }),
      listGrantableMembers(
        {
          resourceId: nodeId,
          query: memberQuery,
          cursor: memberCursor,
          limit: memberLimit,
        },
        { db: session.db }
      ),
    ]);
    return NextResponse.json(
      { choices, floor, grants, members },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not load visibility.';
    return NextResponse.json({ message }, { status: 422 });
  }
}

const floorSchema = z.object({
  resourceId: entityIds.knowledgeResource.prefixSchema, // knr_…
  visibility: z.enum(['private', 'space', 'organization']),
});

export async function PATCH(request: Request) {
  const parsed = floorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }

  try {
    const result = await setResourceFloor(parsed.data, { db: session.db });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not change visibility.';
    // RLS / D9 trigger rejection (not owner, no access) → clean failure.
    return NextResponse.json({ message }, { status: 422 });
  }
}

/**
 * Share body — a discriminated union over `grantType`: a cohort link (landed) or a
 * per-user grant. One POST/DELETE transport for both share kinds, schema-first.
 * `grantType` defaults to `'cohort'` when absent so the landed cohort caller
 * (`{ resourceId, scopeId }`, no discriminator) keeps parsing unchanged — the per-user
 * caller passes `grantType: 'user'` explicitly.
 */
const cohortShareSchema = z.object({
  grantType: z.literal('cohort'),
  resourceId: entityIds.knowledgeResource.prefixSchema, // knr_…
  scopeId: entityIds.scope.prefixSchema,
});

const userShareSchema = z.object({
  grantType: z.literal('user'),
  resourceId: entityIds.knowledgeResource.prefixSchema, // knr_…
  userId: z.string().uuid(),
});

const shareBodySchema = z.preprocess(
  (value) =>
    value && typeof value === 'object' && !('grantType' in value)
      ? { ...value, grantType: 'cohort' }
      : value,
  z.discriminatedUnion('grantType', [cohortShareSchema, userShareSchema])
);

export type CohortShareBody = z.infer<typeof cohortShareSchema>;
export type UserShareBody = z.infer<typeof userShareSchema>;
export type ShareBody = z.infer<typeof shareBodySchema>;

export async function POST(request: Request) {
  const parsed = shareBodySchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db, userId } = session;

  try {
    if (parsed.data.grantType === 'cohort') {
      const result = await linkResourceScope(
        { resourceId: parsed.data.resourceId, scopeId: parsed.data.scopeId },
        { db, userId }
      );
      return NextResponse.json(result, {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const result = await grantResourceToUser(
      {
        resourceId: parsed.data.resourceId,
        userId: parsed.data.userId,
        grantedBy: userId,
      },
      { db }
    );
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Share failed.';
    // RLS rejection (no authority) / same-space guard → clean failure, no fence.
    return NextResponse.json({ message }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const parsed = shareBodySchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db } = session;

  try {
    if (parsed.data.grantType === 'cohort') {
      const result = await unlinkResourceScope(
        { resourceId: parsed.data.resourceId, scopeId: parsed.data.scopeId },
        { db }
      );
      return NextResponse.json(result, {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const result = await revokeResourceUserGrant(
      { resourceId: parsed.data.resourceId, userId: parsed.data.userId },
      { db }
    );
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unshare failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
