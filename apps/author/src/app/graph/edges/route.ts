import { entityIds } from '@workspace/entity-id';
import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  AUTHORABLE_RELATION_TYPES,
  createEdge,
  deleteEdge,
  tagResource,
} from '@/knowledge/fanout';

/**
 * Edge-write for the consumer authoring surface.
 *
 * POST   — create a `relates_to` (link), `tagged` (tag), `contains` (place/move a
 *          node into a folder) or `shortcut` (Drive cross-folder symlink) edge. The
 *          tagged path may also create the `kind='tag'` node first (two-step
 *          tag-on-tagging) when only a title is supplied.
 * DELETE — remove an edge (unlink / untag / un-place / remove shortcut).
 *
 * Auth context: the Supabase SESSION (cookies), under `/author/graph/*`. Postgres
 * RLS is the SOLE write authority: the verb gate (`space.knowledge.create` /
 * `.delete`) is enforced on the knowledge_edges row, never here. `created_by` and
 * the active space come from the SESSION, never the body. Zero service-role. THIN
 * transport: delegate to the UI-agnostic application module.
 */

export const dynamic = 'force-dynamic';

const authorableRelation = z.enum(AUTHORABLE_RELATION_TYPES);

// create relates_to — explicit from/to.
const createRelatesToSchema = z.object({
  action: z.literal('link'),
  spaceId: entityIds.space.prefixSchema,
  fromId: entityIds.knowledgeResource.prefixSchema,
  toId: entityIds.knowledgeResource.prefixSchema,
  position: z.number().int().min(0).optional(),
});

// tag a resource — either an existing tag node id, or a new tag title to create.
const createTaggedSchema = z
  .object({
    action: z.literal('tag'),
    spaceId: entityIds.space.prefixSchema,
    resourceId: entityIds.knowledgeResource.prefixSchema,
    tagId: entityIds.knowledgeResource.prefixSchema.optional(),
    tagTitle: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.tagId) || Boolean(v.tagTitle), {
    message: 'tagId or tagTitle is required.',
  });

// place a node inside a folder — FORWARD `contains` edge folder→child.
const createContainsSchema = z.object({
  action: z.literal('contain'),
  spaceId: entityIds.space.prefixSchema,
  folderId: entityIds.knowledgeResource.prefixSchema,
  childId: entityIds.knowledgeResource.prefixSchema,
  position: z.number().int().min(0).optional(),
});

// cross-folder symlink — FORWARD `shortcut` edge folder→target.
const createShortcutSchema = z.object({
  action: z.literal('shortcut'),
  spaceId: entityIds.space.prefixSchema,
  folderId: entityIds.knowledgeResource.prefixSchema,
  targetId: entityIds.knowledgeResource.prefixSchema,
  position: z.number().int().min(0).optional(),
});

const postSchema = z.discriminatedUnion('action', [
  createRelatesToSchema,
  createTaggedSchema,
  createContainsSchema,
  createShortcutSchema,
]);

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
    if (parsed.data.action === 'link') {
      const result = await createEdge(
        {
          spaceId: parsed.data.spaceId,
          fromId: parsed.data.fromId,
          toId: parsed.data.toId,
          relationType: 'relates_to',
          position: parsed.data.position,
        },
        { db, userId }
      );
      return NextResponse.json(result, {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (parsed.data.action === 'contain') {
      // FORWARD: from_id = folder, to_id = child. Never inverted.
      const result = await createEdge(
        {
          spaceId: parsed.data.spaceId,
          fromId: parsed.data.folderId,
          toId: parsed.data.childId,
          relationType: 'contains',
          position: parsed.data.position,
        },
        { db, userId }
      );
      return NextResponse.json(result, {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (parsed.data.action === 'shortcut') {
      // FORWARD: from_id = folder, to_id = target. Drive-only symlink.
      const result = await createEdge(
        {
          spaceId: parsed.data.spaceId,
          fromId: parsed.data.folderId,
          toId: parsed.data.targetId,
          relationType: 'shortcut',
          position: parsed.data.position,
        },
        { db, userId }
      );
      return NextResponse.json(result, {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const result = await tagResource(
      {
        spaceId: parsed.data.spaceId,
        resourceId: parsed.data.resourceId,
        tagId: parsed.data.tagId,
        tagTitle: parsed.data.tagTitle,
      },
      { db, userId }
    );
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Edge create failed.';
    // RLS rejection (no create verb) → clean failure; the authority is the row
    // policy, not this handler.
    return NextResponse.json({ message }, { status: 422 });
  }
}

// delete by edge id, OR by the (from,to,relation) natural key the unlink/untag UI
// already holds (avoids a round-trip to discover the id).
const deleteByIdSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  edgeId: z.string().min(1),
});

const deleteByTripleSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  fromId: entityIds.knowledgeResource.prefixSchema,
  toId: entityIds.knowledgeResource.prefixSchema,
  relationType: authorableRelation,
});

const deleteSchema = z.union([deleteByIdSchema, deleteByTripleSchema]);

export async function DELETE(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(raw);
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
    const result = await deleteEdge(
      'edgeId' in parsed.data
        ? { spaceId: parsed.data.spaceId, edgeId: parsed.data.edgeId }
        : {
            spaceId: parsed.data.spaceId,
            fromId: parsed.data.fromId,
            toId: parsed.data.toId,
            relationType: parsed.data.relationType,
          },
      { db }
    );
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Edge delete failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
