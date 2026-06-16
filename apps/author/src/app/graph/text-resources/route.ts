import config from '@payload-config';
import { z } from 'zod';
import { createLocalReq, getPayload } from 'payload';
import { NextResponse } from 'next/server';

import { createRlsClientFromRequest } from '@/lib/supabase/rls-from-request';
import {
  createTextResourceWithBody,
  reconcileBodyBridge,
} from '@/knowledge/text-resource.fanout';

/**
 * POST /author/graph/text-resources — node↔body fan-out (slice-03 §5.2-1).
 *
 * Auth context: the Supabase SESSION (cookies), NOT a Payload token. This route
 * lives OUTSIDE Payload's `/api` (separate `/author/graph/*` prefix) so the two
 * auth contexts stay cleanly split in proxy.ts. Postgres RLS is the sole access
 * authority: the endpoint builds the user's RLS-scoped client from cookies and
 * the application module runs every graph write under it (zero service-role).
 *
 * This is a THIN transport wrapper: zod-validate the input, build the RLS client
 * + the user-identity Payload req, delegate to the UI-agnostic application module
 * (discipline C). No fan-out logic here.
 */

export const dynamic = 'force-dynamic';

const edgeSchema = z.object({
  relationType: z.enum(['prerequisite', 'relates_to']),
  toId: z.string().min(1),
});

const requestSchema = z.object({
  spaceId: z.string().min(1),
  title: z.string().min(1),
  // Lexical editor state — opaque to the transport; Payload validates the field.
  lexicalBody: z.unknown(),
  edge: edgeSchema.optional(),
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

  const payload = await getPayload({ config });
  // Build a Local API req carrying the user identity, the same construction the
  // session bridge uses (establish-payload-session-from-access-token.ts:55).
  const req = await createLocalReq(
    { req: { headers: request.headers } },
    payload
  );

  try {
    const result = await createTextResourceWithBody(parsed.data, {
      db,
      payload,
      userId: userData.user.id,
      req,
    });

    // Self-heal sweep at the end of fan-out (§2.4 decision 4): idempotent.
    await reconcileBodyBridge(result.node_id, { db, payload, req }).catch(
      () => undefined
    );

    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fan-out failed.';
    // RLS rejection of the node INSERT (no space.knowledge.create) lands here —
    // the body is never created (fan-out stops at the authoritative first step).
    return NextResponse.json({ message }, { status: 422 });
  }
}
