import { starredToggleSchema } from '@workspace/knowledge-contracts';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import { setResourceStarred } from '@/knowledge/fanout';

/**
 * Per-user "starred" toggle for the consumer authoring surface (ADR-0011 §4).
 *
 * One thin route: validate the body, then delegate to the UI-agnostic
 * resource-starred.fanout module. The star flag is a column on the per-user state
 * anchor `resource_user_state`; toggling shares the per-user-state write path.
 *
 * Auth: the Supabase SESSION under `/author/graph/*`. RLS is the SOLE write
 * authority — the own-rows insert/update policies (verb space.knowledge.progress)
 * gate the write. `user_id` comes from the SESSION, never the body.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = starredToggleSchema.safeParse(raw);
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
    const result = await setResourceStarred(
      {
        spaceId: parsed.data.spaceId,
        nodeId: parsed.data.nodeId,
        starred: parsed.data.starred,
      },
      { db, userId }
    );
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Starred write failed.';
    // RLS rejection (no progress verb on the resource) → clean failure, no row.
    return NextResponse.json({ message }, { status: 422 });
  }
}
