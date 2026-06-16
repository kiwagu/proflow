import config from '@payload-config';
import { z } from 'zod';
import { createLocalReq, getPayload } from 'payload';
import { NextResponse } from 'next/server';

import { createRlsClientFromRequest } from '@/lib/supabase/rls-from-request';
import { reconcileBodyBridge } from '@/knowledge/text-resource.fanout';

/**
 * POST /author/graph/reconcile — manual invocation of the node↔body reconciler
 * (slice-03 §2.4, §8.1 decision 4). Self-heal also runs at the end of fan-out;
 * this endpoint exposes the SAME UI-agnostic application function for the
 * acceptance saga test (heal a missing body_ref / remove an orphan body).
 *
 * Same auth context as the other graph endpoints: Supabase session → RLS client.
 * The reconciler's only service-role use is its internal systemic orphan check.
 */

export const dynamic = 'force-dynamic';

const requestSchema = z.object({ nodeId: z.string().min(1) });

export async function POST(request: Request) {
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

  const payload = await getPayload({ config });
  const req = await createLocalReq(
    { req: { headers: request.headers } },
    payload
  );

  try {
    const result = await reconcileBodyBridge(parsed.data.nodeId, {
      db,
      payload,
      req,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Reconcile failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
