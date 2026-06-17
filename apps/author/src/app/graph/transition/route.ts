import { z } from 'zod';
import { NextResponse } from 'next/server';

import { createRlsClientFromRequest } from '@/lib/supabase/rls-from-request';
import {
  IllegalTransitionError,
  transitionResourceStatus,
} from '@/knowledge/resource-transition';

/**
 * POST /author/graph/transition — move a knowledge resource through its workflow
 * (slice-06 §5.1).
 *
 * Auth context: the Supabase SESSION (cookies), NOT a Payload token. This route
 * lives under `/author/graph/*` (already split from `/admin/*` in proxy.ts), so
 * the Supabase session establishes the RLS context. POST without a session → 401
 * JSON. Zero proxy.ts changes in this slice.
 *
 * THIN transport wrapper (parity with progress/route.ts): zod-validate the input,
 * build the user's RLS-scoped client, derive `user_id` + the caller's guard verbs
 * from the SESSION / roles (NEVER the body, NEVER service-role), and delegate to
 * the UI-agnostic application module. An illegal transition → 422 JSON (not 500).
 */

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  spaceId: z.string().min(1),
  resourceId: z.string().min(1), // knr_…
  toStatus: z.string().min(1), // target status — legality decided by the validator
});

/** Guard verbs the validator may consult on a per-transition basis. */
const GUARD_VERBS = ['space.knowledge.transition', 'space.knowledge.approve'];

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

  // Derive the caller's guard verbs from their ROLES (via the RLS-aware permission
  // helper), NEVER from the body. The set drives per-transition `guard` checks in
  // the validator; the base write verb is also enforced by RLS on the UPDATE.
  const userVerbs = new Set<string>();
  for (const verb of GUARD_VERBS) {
    const { data: granted } = await db.rpc('auth_user_can_access_in_space', {
      p_space_id: parsed.data.spaceId,
      p_permission_key: verb,
    });
    if (granted === true) {
      userVerbs.add(verb);
    }
  }

  try {
    const result = await transitionResourceStatus(parsed.data, {
      db,
      userId: userData.user.id,
      userVerbs,
    });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    // Illegal/unauthorized transition (validator) → 422, nothing written.
    if (error instanceof IllegalTransitionError) {
      return NextResponse.json(
        { message: error.message, reason: error.reason },
        { status: 422 }
      );
    }
    const message =
      error instanceof Error ? error.message : 'Transition failed.';
    // RLS rejection / not-found also lands here as a clean failure.
    return NextResponse.json({ message }, { status: 422 });
  }
}
