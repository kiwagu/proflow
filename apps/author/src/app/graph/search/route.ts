import { entityIds } from '@workspace/entity-id';
import {
  SEARCH_DEFAULT_LIMIT,
  type SearchQuery,
} from '@workspace/knowledge-contracts';
import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import { resolveSearchQuery } from '@/knowledge/resolve';

/**
 * Lexical search endpoint (slice-12 Phase 1) — the runtime path the
 * Drive search lens calls as the user types. Search is a SUBSTRATE capability, a
 * SIBLING of projection-resolve (not a `ProjectionSpec.filter` operator): the
 * browser POSTs only a `term` + `spaceId` + `limit`; raw SQL never crosses the
 * client→server boundary — `resolveSearchQuery` compiles + runs it on the server.
 *
 * Auth context: the Supabase SESSION (cookies), under `/author/graph/*`. The thin
 * route auth-guards (401 when unauthenticated) then delegates to `resolveSearchQuery`,
 * which builds the SAME RLS transport (`createProjectionResolveTransport`, REUSED
 * verbatim) and runs the compiled SELECT AS THE USER. Postgres RLS is the
 * SOLE access fence: a private / other-space node never
 * appears for a non-grantee — there is NO app-level status/visibility filter doing
 * the fencing. Zero service-role on this read path.
 */

export const dynamic = 'force-dynamic';

// The client sends only the raw query shape; the compiler clamps the limit and the
// transport fences by RLS. `mode` is fixed to 'lexical' (Phase 1 — the semantic seam
// is deferred). The term's min length is enforced client-side (the lens
// does not fire below 2 chars); the route accepts any non-empty term defensively.
const searchRequestSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  term: z.string().min(1),
  limit: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = searchRequestSchema.safeParse(raw);
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

  const query: SearchQuery = {
    mode: 'lexical',
    term: parsed.data.term,
    scope: { spaceId: parsed.data.spaceId },
    limit: parsed.data.limit ?? SEARCH_DEFAULT_LIMIT,
  };

  try {
    const result = await resolveSearchQuery(query);
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
