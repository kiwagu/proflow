import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * GET /author/graph/resources?space_id=…&kind=… — RLS-scoped node listing for
 * the edge-target select in the admin-view (slice-03 §5.2-2). A THIN PostgREST
 * select under the user's RLS client (RLS-aware, ADR-0003 §3) — NOT the
 * projection engine. Zero service-role.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const spaceId = url.searchParams.get('space_id')?.trim();
  const kind = url.searchParams.get('kind')?.trim();

  if (!spaceId) {
    return NextResponse.json(
      { message: 'space_id is required.' },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db } = session;

  let query = db
    .from('knowledge_resources')
    .select('id,title,kind,status')
    .eq('space_id', spaceId)
    .order('title', { ascending: true })
    .limit(200);
  if (kind) {
    query = query.eq('kind', kind);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  // RLS already narrowed this to nodes the user may read — no extra filter.
  return NextResponse.json(
    { resources: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
