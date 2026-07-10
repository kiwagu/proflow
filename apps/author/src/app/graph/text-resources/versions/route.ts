import { entityIds } from '@workspace/entity-id';
import config from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload, type Payload } from 'payload';
import { z } from 'zod';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * Document-body version history — the "tangible" draft/publish workflow surface.
 *
 * GET  — list a text node's body versions (Payload records one on every update),
 *        OR (with `version_id`) read a single version's body for read-only view.
 * POST — `{ action: 'restore', versionId }` makes a past version the current body
 *        (Payload records a new version). Verb is `update`; the version must
 *        belong to THIS node's body (parent check), so one cannot restore another
 *        document's revision.
 * DELETE — `{ versionId }` removes a single DRAFT version from history (published
 *        revisions are immutable here). Parent-checked like the others; never a
 *        cross-document delete.
 *
 * Every read/write is gated by node access under the caller's OWN RLS (ADR-0002
 * §2): no node row ⇒ 404; the body is then reached by its bridge key via the
 * Local API with `overrideAccess`. Payload caps history at `maxPerDoc` (Bodies);
 * there is no per-version delete.
 */

export const dynamic = 'force-dynamic';

type Gate =
  | { ok: false; res: NextResponse }
  | { ok: true; payload: Payload; bodyDocId: string | null };

/** Gate node access under RLS, then resolve the body doc id (the version parent). */
async function gate(
  request: Request,
  nodeId: string,
  spaceId: string
): Promise<Gate> {
  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return { ok: false, res: session };
  }
  const { db } = session;

  const { data: node, error } = await db
    .from('knowledge_resources')
    .select('id')
    .eq('id', nodeId)
    .eq('space_id', spaceId)
    .eq('kind', 'text')
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      res: NextResponse.json({ message: error.message }, { status: 500 }),
    };
  }
  if (!node) {
    return {
      ok: false,
      res: NextResponse.json(
        { message: 'Text resource not found.' },
        { status: 404 }
      ),
    };
  }

  // Resolve the body doc id from the MAIN collection — NOT the `draft: true`
  // versions view, which goes empty if the `latest` version was pruned (then the
  // list would wrongly show zero versions even though history remains).
  const payload = await getPayload({ config });
  const { docs } = await payload.find({
    collection: 'bodies',
    where: { node_id: { equals: nodeId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
    pagination: false,
  });
  const doc = docs[0] as { id?: string } | undefined;
  return { ok: true, payload, bodyDocId: doc?.id ?? null };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nodeId = url.searchParams.get('node_id')?.trim();
  const spaceId = url.searchParams.get('space_id')?.trim();
  const versionId = url.searchParams.get('version_id')?.trim();

  if (!nodeId || !spaceId) {
    return NextResponse.json(
      { message: 'node_id and space_id are required.' },
      { status: 400 }
    );
  }

  const gated = await gate(request, nodeId, spaceId);
  if (!gated.ok) {
    return gated.res;
  }
  const { payload, bodyDocId } = gated;

  // View a single revision's body (read-only) — verify it belongs to this body.
  if (versionId) {
    if (!bodyDocId) {
      return NextResponse.json(
        { message: 'Version not found.' },
        { status: 404 }
      );
    }
    const version = (await payload
      .findVersionByID({
        collection: 'bodies',
        id: versionId,
        overrideAccess: true,
        depth: 0,
      })
      .catch(() => null)) as {
      parent?: string;
      version?: { body?: unknown };
    } | null;
    if (!version || version.parent !== bodyDocId) {
      return NextResponse.json(
        { message: 'Version not found.' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { body: version.version?.body ?? null },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // List versions (newest first).
  if (!bodyDocId) {
    return NextResponse.json(
      { versions: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const { docs: versions } = await payload.findVersions({
    collection: 'bodies',
    where: { parent: { equals: bodyDocId } },
    overrideAccess: true,
    depth: 0,
    limit: 50,
    sort: '-updatedAt',
    pagination: false,
  });
  const list = versions.map((entry) => {
    const v = entry as {
      id: string;
      updatedAt: string;
      version?: { _status?: string };
    };
    return {
      id: v.id,
      status: v.version?._status ?? null,
      updatedAt: v.updatedAt,
    };
  });
  return NextResponse.json(
    { versions: list },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

const restoreSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema,
  versionId: z.string().min(1),
  action: z.literal('restore').default('restore'),
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = restoreSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const gated = await gate(request, parsed.data.nodeId, parsed.data.spaceId);
  if (!gated.ok) {
    return gated.res;
  }
  const { payload, bodyDocId } = gated;
  if (!bodyDocId) {
    return NextResponse.json(
      { message: 'Version not found.' },
      { status: 404 }
    );
  }

  // The version must belong to THIS node's body (no cross-document restore).
  const version = (await payload
    .findVersionByID({
      collection: 'bodies',
      id: parsed.data.versionId,
      overrideAccess: true,
      depth: 0,
    })
    .catch(() => null)) as { parent?: string } | null;
  if (!version || version.parent !== bodyDocId) {
    return NextResponse.json(
      { message: 'Version not found.' },
      { status: 404 }
    );
  }

  try {
    await payload.restoreVersion({
      collection: 'bodies',
      id: parsed.data.versionId,
      overrideAccess: true,
    });
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Restore failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}

const deleteSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema,
  versionId: z.string().min(1),
});

export async function DELETE(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const gated = await gate(request, parsed.data.nodeId, parsed.data.spaceId);
  if (!gated.ok) {
    return gated.res;
  }
  const { payload, bodyDocId } = gated;
  if (!bodyDocId) {
    return NextResponse.json(
      { message: 'Version not found.' },
      { status: 404 }
    );
  }

  // The version must belong to THIS node's body (no cross-document delete) AND be
  // a DRAFT — published revisions are kept as the immutable approval record.
  const version = (await payload
    .findVersionByID({
      collection: 'bodies',
      id: parsed.data.versionId,
      overrideAccess: true,
      depth: 0,
    })
    .catch(() => null)) as {
    parent?: string;
    version?: { _status?: string };
  } | null;
  if (!version || version.parent !== bodyDocId) {
    return NextResponse.json(
      { message: 'Version not found.' },
      { status: 404 }
    );
  }
  if (version.version?._status === 'published') {
    return NextResponse.json(
      { message: 'Only draft versions can be deleted.' },
      { status: 422 }
    );
  }

  try {
    await payload.db.deleteVersions({
      collection: 'bodies',
      where: { id: { equals: parsed.data.versionId } },
    });
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
