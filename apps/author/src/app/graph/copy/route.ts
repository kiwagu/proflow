import { entityIds } from '@workspace/entity-id';
import config from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import { z } from 'zod';

import { copyResourceSubtree } from '@/knowledge/fanout';
import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * Deep-copy a resource and its `contains` subtree (ADR-0015 containment, ADR-0017
 * fail-closed). A cross-store fan-out: nodes + edges in Postgres under the user's
 * RLS, each text body cloned via the Payload Local API. The clone is the COPIER's
 * own private content — `created_by`/`owner` from the SESSION, `visibility` left at
 * the private default, never the source's audience.
 *
 * Auth context: the Supabase SESSION (cookies). Postgres RLS is the SOLE authority
 * — the traversal copies only what the copier may read, and every INSERT is gated
 * by `space.knowledge.create`. Zero service-role. THIN transport: delegate to the
 * UI-agnostic fan-out.
 */

export const dynamic = 'force-dynamic';

const copySchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  sourceId: entityIds.knowledgeResource.prefixSchema, // knr_… root of the subtree to copy
  // The copy's destination folder, or null for the top level.
  targetFolderId: entityIds.knowledgeResource.prefixSchema
    .nullable()
    .default(null),
  // The caller-built "(copy)" title for the root (i18n stays in the front).
  rootTitle: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = copySchema.safeParse(raw);
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
    const payload = await getPayload({ config });
    const result = await copyResourceSubtree(parsed.data, {
      db,
      userId,
      payload,
    });
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Copy failed.';
    // RLS rejection (no space.knowledge.create) / unreadable source → clean failure.
    return NextResponse.json({ message }, { status: 422 });
  }
}
