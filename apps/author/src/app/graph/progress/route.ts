import { coarseStatusSchema } from '@workspace/knowledge-contracts/resource-user-state';
import { z } from 'zod';
import { NextResponse } from 'next/server';

import { createRlsClientFromRequest } from '@/lib/supabase/rls-from-request';
import { setResourceUserState } from '@/knowledge/resource-user-state';

/**
 * POST /author/graph/progress — upsert the caller's per-resource coarse status
 * (slice-05 §5.1).
 *
 * Auth context: the Supabase SESSION (cookies), NOT a Payload token. This route
 * lives under `/author/graph/*` (already split from `/admin/*` in proxy.ts), so
 * the Supabase session — not `payload-token` — establishes the RLS context. POST
 * without a session → 401 JSON. Zero proxy.ts changes in this slice.
 *
 * THIN transport wrapper (parity with text-resources/route.ts): zod-validate the
 * input, build the user's RLS-scoped client, read `user_id` from the SESSION (not
 * the body), and delegate to the UI-agnostic application module. NEVER
 * service-role — Postgres RLS is the sole write authority.
 */

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  spaceId: z.string().min(1),
  resourceId: z.string().min(1), // knr_…
  coarseStatus: coarseStatusSchema,
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // User's RLS-scoped client (never service-role) — Postgres RLS is the authority.
  const db = createRlsClientFromRequest(request);
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData.user?.id) {
    return NextResponse.json(
      { message: 'Not authenticated.' },
      { status: 401 }
    );
  }

  try {
    // user_id comes from the SESSION, never the body — a forged user_id cannot
    // write a foreign row, and RLS WITH CHECK is the final gate either way.
    const result = await setResourceUserState(parsed.data, {
      db,
      userId: userData.user.id,
    });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Progress write failed.';
    // RLS rejection (no space.knowledge.progress, or own-rows violation) lands
    // here — clean failure, nothing written.
    return NextResponse.json({ message }, { status: 422 });
  }
}
