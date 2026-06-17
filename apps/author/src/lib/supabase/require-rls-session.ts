import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { createRlsClientFromRequest } from '@/lib/supabase/rls-from-request';

/**
 * Shared auth guard for the `/author/graph/*` route handlers. Every one of those
 * handlers opened with the IDENTICAL block: build the user's RLS-scoped client
 * from the request cookies, `getUser()`, and return a 401 JSON when there is no
 * session. Extracted here so the guard lives in ONE place (parity of the 401
 * shape, the RLS-scoped client construction, and the "never service-role" rule).
 *
 * Returns either `{ db, userId }` for an authenticated caller, or a ready 401
 * `NextResponse` the handler should return as-is. Callers narrow with the
 * exported `isAuthFailure` type guard.
 */

export type RlsSession = {
  db: SupabaseClient<Database>;
  userId: string;
};

export function isAuthFailure(
  result: RlsSession | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}

export async function requireRlsSession(
  request: Request
): Promise<RlsSession | NextResponse> {
  // User's RLS-scoped client (never service-role) — Postgres RLS is the authority.
  const db = createRlsClientFromRequest(request);
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData.user?.id) {
    return NextResponse.json(
      { message: 'Not authenticated.' },
      { status: 401 }
    );
  }
  return { db, userId: userData.user.id };
}
