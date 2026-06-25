import { trashResourceInputSchema } from '@workspace/knowledge-contracts';
import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  createBodylessResource,
  renameResource,
  trashResource,
} from '@/knowledge/fanout';

/**
 * Resource node read + body-less write for the consumer authoring surface.
 *
 * GET    — RLS-scoped node listing (edge-target select for the node picker). A THIN
 *          PostgREST select under the user's RLS client.
 * POST   — create a body-less node (`link`/`tag`/`folder`/`file`/`video`), optionally
 *          placed inside a folder via a `contains` edge. A single RLS-scoped INSERT
 *          (ADR-0002 §3 / ADR-0015). `text` creation stays on text-resources (the
 *          fan-out with the body).
 * PATCH  — rename a node's title under `space.knowledge.update`.
 * DELETE — TRASH a node (soft-delete, reference-aware, ADR-0018) under the
 *          owner-sovereign-or-`space.knowledge.delete` authority guard. References
 *          (edges, body) are PRESERVED-but-dormant; the soft-cascade trashes
 *          containment orphans (a child with another LIVING parent survives).
 *          Reversible — restore via `/author/graph/trash`. Permanent destruction
 *          is the DISTINCT purge path (`DELETE /author/graph/trash`), reached only
 *          from the Trash lens. Works for ALL kinds incl. `text` (the old N→1
 *          reference-severing reason for disabling text delete is gone).
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
  // text → text-resources (carries a body). link/tag/folder/file/video are
  // body-less (ADR-0002 §3 / ADR-0015).
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

export async function DELETE(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = trashResourceInputSchema.safeParse(raw);
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
    const result = await trashResource(parsed.data, { db });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trash failed.';
    // RLS rejection (not owner, no space.knowledge.delete) → clean failure,
    // nothing trashed. The authority guard raises 42501.
    return NextResponse.json({ message }, { status: 422 });
  }
}
