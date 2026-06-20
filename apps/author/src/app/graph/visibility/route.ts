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
} from '@/knowledge/fanout';

/**
 * Resource visibility — cohort/scope sharing for the consumer authoring surface.
 *
 * GET    — list the space's cohort scopes + whether this node is fenced to each.
 * POST   — link a resource to a cohort scope (fence it: members-only-read).
 * DELETE — unlink (widen back toward all-space-readers).
 *
 * Auth context: the Supabase SESSION under `/author/graph/*`. Postgres RLS is the
 * SOLE authority: link/unlink gate on `space.knowledge.access` in the resource's
 * space, enforced on the `knowledge_resource_scopes` row; `linked_by` comes from
 * the SESSION, never the body. Zero service-role. THIN transport.
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
    const choices = await listScopeChoices(
      { spaceId, nodeId },
      { db: session.db }
    );
    return NextResponse.json(
      { choices },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not load visibility.';
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
