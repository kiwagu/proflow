import { parseNeighborhoodSpec } from '@workspace/knowledge-contracts';
import { resolveNeighborhood } from '@workspace/knowledge-engine';
import { NextResponse } from 'next/server';

import {
  createProjectionResolveTransport,
  resolveJwtClaimsFromSession,
} from '@/knowledge/projection-resolve.transport';
import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * GET /author/graph/neighborhood — the bounded-BFS read port for the lens rail +
 * resource panel (slice-09 §3.4, ADR-0010). Expands ONE center node over the
 * requested relation types, bounded to `depth ≤ 2`, under the user's RLS.
 *
 *   ?space_id=…&node_id=…&rel=relates_to,tagged&dir=both&depth=1
 *
 * This is a THIN transport (parity with resources/route.ts): require the session,
 * zod-clamp the spec (`max_depth` ≤ 2 enforced by the contract BEFORE compile),
 * lift the user's JWT claims and run `resolveNeighborhood` over the SAME per-user
 * RLS transport `resolveProjection` uses (ADR-0009) — never service-role. RLS has
 * already narrowed the result; an ungranted caller gets `neighbors: []`, not an
 * error. No traversal logic lives here — it is the engine port's job. `no-store`.
 *
 * Auth context: the Supabase SESSION (cookies), under `/author/graph/*` (already
 * split from `/admin/*` in proxy.ts — a guest XHR with `Accept: application/json`
 * gets a 401 JSON, correct). Zero proxy changes.
 */

export const dynamic = 'force-dynamic';

const ALLOWED_RELATIONS = new Set(['relates_to', 'tagged', 'part_of']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const spaceId = url.searchParams.get('space_id')?.trim();
  const centerId = url.searchParams.get('node_id')?.trim();

  if (!spaceId || !centerId) {
    return NextResponse.json(
      { message: 'space_id and node_id are required.' },
      { status: 400 }
    );
  }

  const relationTypes = (url.searchParams.get('rel') ?? 'relates_to,tagged')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => ALLOWED_RELATIONS.has(value));
  if (relationTypes.length === 0) {
    return NextResponse.json(
      { message: 'rel must list at least one known relation type.' },
      { status: 400 }
    );
  }

  const directionRaw = url.searchParams.get('dir')?.trim() ?? 'outgoing';
  const direction: 'outgoing' | 'incoming' | 'both' =
    directionRaw === 'incoming' || directionRaw === 'both'
      ? directionRaw
      : 'outgoing';

  const depthRaw = Number.parseInt(url.searchParams.get('depth') ?? '1', 10);
  const maxDepth = Number.isFinite(depthRaw) ? depthRaw : 1;

  // The contract clamps max_depth to 1..2 and validates the shape; the raw depth
  // never reaches SQL as a number — it is bound as a positional param after this.
  // `both` is a SINGLE bounded-BFS walk through the engine port (ONE recursive CTE
  // matching both edge sides) — no presentation-side stitching of two walks.
  const parsed = parseNeighborhoodSpec({
    schema_version: 1,
    relation_types: relationTypes,
    direction,
    max_depth: maxDepth,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid neighborhood spec', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db } = session;

  try {
    const claims = await resolveJwtClaimsFromSession(db);
    const transport = createProjectionResolveTransport(claims);
    const result = await resolveNeighborhood(parsed.data, {
      centerId,
      spaceId,
      db,
      transport,
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Neighborhood resolve failed.';
    return NextResponse.json({ message }, { status: 500 });
  }
}
