import { setResourceStatusInputSchema } from '@workspace/knowledge-contracts';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import { setResourceStatus } from '@/knowledge/fanout';

/**
 * Resource workflow status — set a node's lifecycle state (`draft`/`active`/
 * `archived`). One scalar column write, the exact transport twin of the visibility
 * floor PATCH (`/author/graph/visibility`): status (workflow) is ORTHOGONAL to
 * `visibility` (access) and `deleted_at` (trash), so it gets its own thin endpoint
 * rather than muddying the rename PATCH on `/author/graph/resources`.
 *
 * PATCH — set `{ resourceId, status }` under `space.knowledge.update`.
 *
 * Auth context: the Supabase SESSION under `/author/graph/*`. Postgres RLS is the
 * SOLE write authority — the `space.knowledge.update` verb is enforced on the row
 * UPDATE, never here. Zero service-role. THIN transport: delegate to the UI-agnostic
 * application module.
 */

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  const parsed = setResourceStatusInputSchema.safeParse(
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

  try {
    const result = await setResourceStatus(parsed.data, { db: session.db });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not change status.';
    // RLS rejection (no space.knowledge.update) / not-found → clean failure.
    return NextResponse.json({ message }, { status: 422 });
  }
}
