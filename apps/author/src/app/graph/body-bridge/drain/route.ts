import { z } from 'zod';
import { NextResponse } from 'next/server';

import { createRlsClientFromRequest } from '@/lib/supabase/rls-from-request';
import { drainBodyBridgeOutboxOnce } from '@/knowledge/body-bridge.outbox-worker';

/**
 * POST /author/graph/body-bridge/drain — DETERMINISTIC trigger for one pass of the
 * async body-bridge outbox consumer (slice-08 §6). The consumer normally runs on a
 * poll timer in its own tsx process; the acceptance suite must drain on demand
 * (not wait on the timer), and the consumer's Payload Local API lives inside THIS
 * runtime — so the e2e drives the drain over HTTP, exactly as the slice-03 saga
 * test drives `/author/graph/reconcile`.
 *
 * Auth context: the Supabase SESSION (cookies), same split as the other
 * `/author/graph/*` endpoints (NOT a Payload token). The drain itself runs the
 * trusted-backend claim/reconcile under service-role (§5), so this thin trigger is
 * GATED: the caller must be authenticated AND hold `space.knowledge.create` in the
 * supplied space (a legitimate author of the tenant). It is not an open
 * service-role trigger. The worker's poll loop is the production path; this
 * endpoint exists purely for deterministic acceptance.
 *
 * NOT EXPOSED IN PRODUCTION. The endpoint has zero production purpose (the prod
 * path is the poll-loop worker), so it is hard-off when `NODE_ENV === 'production'`
 * — it 404s as if it did not exist, regardless of gateway/proxy config. `next dev`
 * (local dev + the e2e stack against proflow.local) runs NODE_ENV !== 'production',
 * so the acceptance suite still reaches it; a `next start` prod build never does.
 * This is defense-in-depth on top of the session + capability gate below.
 */

export const dynamic = 'force-dynamic';

const requestSchema = z.object({ spaceId: z.string().min(1) });

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const db = createRlsClientFromRequest(request);
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData.user?.id) {
    return NextResponse.json(
      { message: 'Not authenticated.' },
      { status: 401 }
    );
  }

  // Authority gate: only an author who can create in this space may trigger a
  // drain. Evaluated under the caller's RLS context (never service-role).
  const { data: allowed, error: capErr } = await db.rpc(
    'auth_user_can_access_in_space',
    {
      p_space_id: parsed.data.spaceId,
      p_permission_key: 'space.knowledge.create',
    }
  );
  if (capErr) {
    return NextResponse.json({ message: capErr.message }, { status: 422 });
  }
  if (allowed !== true) {
    return NextResponse.json(
      { message: 'Not allowed in this space.' },
      { status: 403 }
    );
  }

  try {
    await drainBodyBridgeOutboxOnce();
    return NextResponse.json(
      { drained: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Drain failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
