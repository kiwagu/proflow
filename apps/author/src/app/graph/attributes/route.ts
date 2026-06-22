import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import { setResourceDescription } from '@/knowledge/fanout';

/**
 * KB application-attribute write for the consumer authoring surface (ADR-0011 §4).
 *
 * One thin route for ALL node satellites, discriminated by `attribute` — every
 * satellite is the SAME operation shape (a 1:1 UPSERT keyed by node_id under the
 * SAME RLS verb mirror), so they share identical session/zod/delegate plumbing.
 * Today only `description` is landed; new attributes (link / media-meta / …) are a
 * one-line schema member + case as their satellites land. The write LOGIC lives in
 * the UI-agnostic kb-attribute.fanout module; this route only validates + delegates.
 *
 * Auth: the Supabase SESSION under `/author/graph/*`. RLS is the SOLE write
 * authority — satellite policies mirror the parent node's access (write =
 * `space.knowledge.update`). `created_by` comes from the SESSION, never the body.
 */

export const dynamic = 'force-dynamic';

const descriptionSchema = z.object({
  attribute: z.literal('description'),
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  body: z.string(),
});

const postSchema = z.discriminatedUnion('attribute', [descriptionSchema]);

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(raw);
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
    const d = parsed.data;
    switch (d.attribute) {
      case 'description': {
        const result = await setResourceDescription(
          { spaceId: d.spaceId, nodeId: d.nodeId, body: d.body },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }
    // exhaustive over the union today; future attributes add a case above.
    return NextResponse.json(
      { message: 'Unsupported attribute.' },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Attribute write failed.';
    // RLS rejection (no update verb on the node) → clean failure, no row.
    return NextResponse.json({ message }, { status: 422 });
  }
}
