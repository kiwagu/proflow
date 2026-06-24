import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  linkResourceScope,
  listScopeChoices,
  unlinkResourceScope,
  loadResourceFloor,
  setResourceFloor,
} from '@/knowledge/fanout';

/**
 * Resource visibility — broadcast floor + cohort grants for the authoring surface
 * (ADR-0017 Model B).
 *
 * GET    — the node's current floor (`visibility`) + the space's cohort scopes and
 *          whether this node is granted to each.
 * PATCH  — set the broadcast floor (publish private→space, or restrict space→private).
 * POST   — grant a cohort access (additive; share with members).
 * DELETE — remove a cohort grant.
 *
 * Auth context: the Supabase SESSION under `/author/graph/*`. Postgres RLS is the SOLE
 * authority: cohort link/unlink gate on `space.knowledge.access`; the floor change is
 * owner-sovereign (D9 trigger: owner OR `space.knowledge.access`). `linked_by` comes
 * from the SESSION, never the body. Zero service-role. THIN transport.
 */

export const dynamic = 'force-dynamic';

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

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }

  try {
    const [choices, floor] = await Promise.all([
      listScopeChoices({ spaceId, nodeId }, { db: session.db }),
      loadResourceFloor({ nodeId }, { db: session.db }),
    ]);
    return NextResponse.json(
      { choices, floor },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not load visibility.';
    return NextResponse.json({ message }, { status: 422 });
  }
}

const floorSchema = z.object({
  resourceId: z.string().min(1), // knr_…
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

const bodySchema = z.object({
  resourceId: z.string().min(1), // knr_…
  scopeId: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
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
    const result = await linkResourceScope(parsed.data, { db, userId });
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Share failed.';
    // RLS rejection (no space.knowledge.access) → clean failure, no fence.
    return NextResponse.json({ message }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
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
    const result = await unlinkResourceScope(parsed.data, { db });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unshare failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
