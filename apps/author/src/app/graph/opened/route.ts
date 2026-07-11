import { parseOpenedRecord } from '@workspace/knowledge-contracts';
import { NextResponse } from 'next/server';

import { recordResourceOpened } from '@/knowledge/fanout';
import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * Per-user "open" write for the consumer authoring surface. Records a
 * DELIBERATE open ("recently opened by me") — the call site
 * fires this on ResourcePanel / doc-editor / folder-navigation open, NEVER on
 * hover/list-render (that would make "Recent" = "recently scrolled past").
 *
 * A thin transport: zod-validate `{ spaceId, nodeId }`, resolve the user's RLS
 * session, delegate to the UI-agnostic `recordResourceOpened` fan-out. The write
 * LOGIC lives in the fan-out; this route only validates + delegates.
 *
 * Auth: the Supabase SESSION under `/author/graph/*`. RLS is the SOLE write
 * authority — the open append is gated by the dedicated `space.knowledge.open`
 * verb; `user_id` comes from the SESSION, never the body. Zero service-role.
 *
 * Best-effort by design (§3.3): a failed open must never block the read. An RLS
 * rejection is surfaced as a clean 422, not a user error — the client fires this
 * and does not await it on the read path.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = parseOpenedRecord(raw);
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

  const result = await recordResourceOpened(
    { spaceId: parsed.data.spaceId, nodeId: parsed.data.nodeId },
    { db, userId }
  );

  if (!result.ok) {
    // RLS rejection (no space.knowledge.open on the node) → clean failure, no row.
    return NextResponse.json(
      { message: 'Open could not be recorded.' },
      { status: 422 }
    );
  }

  return NextResponse.json(
    { ok: true, recorded: result.recorded },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
