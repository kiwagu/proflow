import config from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import { z } from 'zod';

import { createTextResource } from '@/knowledge/fanout';
import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * Text-resource write for the consumer authoring surface — the ONE node kind
 * that carries a Lexical body (ADR-0002 §1, ADR-0005).
 *
 * GET  — read a node's Lexical body. The cross-store RLS gate (ADR-0002 §2):
 *        first resolve node access under the user's OWN RLS (a PostgREST select
 *        on `knowledge_resources` — no row ⇒ no access ⇒ 404), THEN read the
 *        `bodies` doc by `node_id` via the Payload Local API with
 *        `overrideAccess` (the gate already passed). Body access is subordinate
 *        to node access — never a second authority.
 *        This is the AUTHOR/moderator surface, so it reads the LATEST version
 *        (`draft: true`) — the editor sees their own in-progress edit
 *        immediately. A future CONSUMER surface reads the published version.
 * POST — create a `kind=text` node + its Payload `bodies` doc, bridged by
 *        `body_ref`, optionally placed inside a folder (FORWARD `contains`
 *        edge, ADR-0015). A SYNCHRONOUS cross-store fan-out: the node INSERT is
 *        gated by Postgres RLS (`space.knowledge.create`) under the user's
 *        session; the body is born via the Payload Local API. All-or-nothing —
 *        a post-INSERT failure is compensated by deletion (see the fan-out).
 *
 * Body-less kinds (`link`/`tag`/`folder`/`file`/`video`) stay on `resources`.
 * Postgres RLS is the SOLE write authority; zero service-role.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nodeId = url.searchParams.get('node_id')?.trim();
  const spaceId = url.searchParams.get('space_id')?.trim();

  if (!nodeId || !spaceId) {
    return NextResponse.json(
      { message: 'node_id and space_id are required.' },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db } = session;

  // Gate: resolve node access under the caller's RLS. RLS already narrows to
  // nodes the user may read — an inaccessible (or non-existent) node returns no
  // row, which we surface as 404. Body access is gated by node access.
  const { data: node, error: nodeErr } = await db
    .from('knowledge_resources')
    .select('id')
    .eq('id', nodeId)
    .eq('space_id', spaceId)
    .eq('kind', 'text')
    .maybeSingle();
  if (nodeErr) {
    return NextResponse.json({ message: nodeErr.message }, { status: 500 });
  }
  if (!node) {
    return NextResponse.json(
      { message: 'Text resource not found.' },
      { status: 404 }
    );
  }

  // Read the body by node_id (the bridge key; unique in `bodies`). The gate
  // passed, so overrideAccess is safe here — Bodies access stays the defence for
  // direct admin/REST reads. `draft: true` returns the LATEST version (draft or
  // published) — the author/moderator surface shows the in-progress edit.
  const payload = await getPayload({ config });
  const { docs } = await payload.find({
    collection: 'bodies',
    where: { node_id: { equals: nodeId } },
    overrideAccess: true,
    draft: true,
    depth: 0,
    limit: 1,
    pagination: false,
  });
  const doc = docs[0] as { body?: unknown } | undefined;

  return NextResponse.json(
    { node_id: nodeId, body: doc?.body ?? null },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

const parentFolderSchema = z.object({
  parentFolderId: z.string().min(1),
  position: z.number().int().min(0).optional(),
});

const createSchema = z.object({
  spaceId: z.string().min(1),
  title: z.string().min(1),
  // The seed Lexical body. Optional — the fan-out defaults to an empty body
  // (empty-but-live until the editor lands). Passed through to the richText
  // field as-is; Payload validates the Lexical shape.
  lexicalBody: z.unknown().optional(),
  parentFolder: parentFolderSchema.optional(),
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
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
    const result = await createTextResource(parsed.data, {
      db,
      userId,
      payload,
    });
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Text resource create failed.';
    // RLS rejection (no space.knowledge.create) → clean failure, no row.
    return NextResponse.json({ message }, { status: 422 });
  }
}
