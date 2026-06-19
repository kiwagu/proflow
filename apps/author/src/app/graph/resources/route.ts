import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import { createBodylessResource, renameResource } from '@/knowledge/fanout';

/**
 * Resource node read + body-less write for the consumer authoring surface.
 *
 * GET    — RLS-scoped node listing (edge-target select for NodePicker, slice-03
 *          §5.2-2). A THIN PostgREST select under the user's RLS client.
 * POST   — create a body-less node (`link`/`tag`). ADR-0002 §3: only `text` is
 *          born through Payload, so link/tag carry NO Lexical body and NO Payload
 *          doc — a single RLS-scoped INSERT (slice-09 §3.6). `text` creation stays
 *          on text-resources/route.ts (the fan-out with the body).
 * PATCH  — rename a node's title (slice-09 §3.6) under `space.knowledge.update`.
 *
 * Auth context: the Supabase SESSION (cookies), under `/author/graph/*`. Postgres
 * RLS is the SOLE write authority — the verb gate is enforced on the row, never
 * here. `created_by`/`owner` come from the SESSION, never the body. Zero
 * service-role. THIN transport: delegate to the UI-agnostic application module.
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

const startEdgeSchema = z.object({
  relationType: z.enum(['prerequisite', 'relates_to']),
  toId: z.string().min(1),
});

// Optional containment placement: create the node inside a folder via a FORWARD
// `contains` edge (folder→child, ADR-0015). `parentFolderId` is the folder.
const parentFolderSchema = z.object({
  parentFolderId: z.string().min(1),
  position: z.number().int().min(0).optional(),
});

const createSchema = z.object({
  spaceId: z.string().min(1),
  // text → text-resources/route.ts (carries a body). link/tag/folder/file/video
  // are body-less (ADR-0002 §3 / ADR-0015: folder is a pure container kind;
  // file/video carry their resource via the media-meta satellite, real binary
  // upload deferred — poc-no-fallbacks).
  kind: z.enum(['link', 'tag', 'folder', 'file', 'video']),
  title: z.string().min(1),
  edge: startEdgeSchema.optional(),
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
    const result = await createBodylessResource(parsed.data, { db, userId });
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Resource create failed.';
    // RLS rejection (no space.knowledge.create) → clean failure, no row.
    return NextResponse.json({ message }, { status: 422 });
  }
}

const renameSchema = z.object({
  spaceId: z.string().min(1),
  resourceId: z.string().min(1), // knr_…
  title: z.string().min(1),
});

export async function PATCH(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = renameSchema.safeParse(raw);
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
  const { db } = session;

  try {
    const result = await renameResource(parsed.data, { db });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rename failed.';
    // RLS rejection (no space.knowledge.update) / not-found → clean failure.
    return NextResponse.json({ message }, { status: 422 });
  }
}
