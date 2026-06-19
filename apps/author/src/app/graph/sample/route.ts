import config from '@payload-config';
import { z } from 'zod';
import { createLocalReq, getPayload } from 'payload';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  SampleAlreadySeededError,
  seedSampleKnowledgeGraph,
} from '@/knowledge/sample-knowledge-graph.builder';

/**
 * POST /author/graph/sample — seed an illustrative knowledge graph (slice-11 Ф2).
 *
 * Builds an EXAMPLE graph exercising every engine capability (nested folders,
 * docs + bodies, link, file/video + media-meta, tags, associations, a shortcut,
 * descriptions + provenance) so a fresh user is not staring at a blank slate. The
 * whole graph is built under the USER's RLS — it is the user's own data, NOT a
 * system seed; `created_by` comes from the session. Zero service-role.
 *
 * THIN transport wrapper (parity with text-resources/route.ts): zod-validate, build
 * the RLS client + user-identity Payload req, delegate to the UI-agnostic builder.
 * The builder reuses the existing fan-out modules — no seed logic here.
 *
 * Idempotency: the builder bails with `SampleAlreadySeededError` (→ 409) when its
 * sentinel sample-root folder already exists in the space.
 */

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  spaceId: z.string().min(1),
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

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db, userId } = session;

  const payload = await getPayload({ config });
  const req = await createLocalReq(
    { req: { headers: request.headers } },
    payload
  );

  try {
    const result = await seedSampleKnowledgeGraph(parsed.data.spaceId, {
      db,
      payload,
      userId,
      req,
    });
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SampleAlreadySeededError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    const message =
      error instanceof Error ? error.message : 'Sample seed failed.';
    // RLS rejection (no space.knowledge.create on the user) → clean failure.
    return NextResponse.json({ message }, { status: 422 });
  }
}
