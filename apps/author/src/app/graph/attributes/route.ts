import { z } from 'zod';
import { NextResponse } from 'next/server';
import { provenanceSourceSchema } from '@workspace/kb-contracts';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  incrementResourceViewCount,
  setResourceDescription,
  setResourceLink,
  setResourceMediaMeta,
  setResourceProvenance,
} from '@/knowledge/kb-attribute.fanout';

/**
 * KB application-attribute write for the consumer authoring surface (slice-11 Ф2).
 *
 * One thin route for ALL node satellites (description / provenance / link /
 * media-meta / activity), discriminated by `attribute`. Single route because every
 * satellite is the SAME shape of operation — a 1:1 UPSERT keyed by node_id under
 * the SAME RLS verb mirror — sharing identical session/zod/delegate plumbing;
 * splitting per entity would duplicate that boilerplate five times with no gain.
 * The per-attribute write LOGIC lives in the UI-agnostic kb-attribute.fanout
 * module (ADR-0011 §4); this route only validates and delegates.
 *
 * Auth context: the Supabase SESSION (cookies), under `/author/graph/*` (already
 * split from `/admin/*` in proxy.ts). Postgres RLS is the SOLE write authority —
 * the satellite policies mirror the parent node's access via the landed
 * `auth_user_can_access_resource` helper (write = `space.knowledge.update`; the
 * view counter mirrors node READ). `created_by` comes from the SESSION, never the
 * body. Zero service-role.
 *
 * embed-status is intentionally NOT writable here — it is a RAG seam with no
 * vector pipeline; flipping it to "indexed" would be a lie (poc-no-fallbacks).
 */

export const dynamic = 'force-dynamic';

const descriptionSchema = z.object({
  attribute: z.literal('description'),
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  body: z.string(),
});

const provenanceSchema = z.object({
  attribute: z.literal('provenance'),
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  source: provenanceSourceSchema,
});

const linkSchema = z.object({
  attribute: z.literal('link'),
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  url: z.string().url(),
  host: z.string().nullable().optional(),
});

const mediaMetaSchema = z.object({
  attribute: z.literal('media-meta'),
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  byteSize: z.number().int().min(0).nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
  mimeType: z.string().nullable().optional(),
});

const activitySchema = z.object({
  attribute: z.literal('view'),
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
});

const postSchema = z.discriminatedUnion('attribute', [
  descriptionSchema,
  provenanceSchema,
  linkSchema,
  mediaMetaSchema,
  activitySchema,
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
    const d = parsed.data;
    switch (d.attribute) {
      case 'description': {
        const result = await setResourceDescription(
          { spaceId: d.spaceId, nodeId: d.nodeId, body: d.body },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      case 'provenance': {
        const result = await setResourceProvenance(
          { spaceId: d.spaceId, nodeId: d.nodeId, source: d.source },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      case 'link': {
        const result = await setResourceLink(
          { spaceId: d.spaceId, nodeId: d.nodeId, url: d.url, host: d.host },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      case 'media-meta': {
        const result = await setResourceMediaMeta(
          {
            spaceId: d.spaceId,
            nodeId: d.nodeId,
            byteSize: d.byteSize,
            durationMs: d.durationMs,
            mimeType: d.mimeType,
          },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      case 'view': {
        const result = await incrementResourceViewCount(
          { spaceId: d.spaceId, nodeId: d.nodeId },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Attribute write failed.';
    // RLS rejection (no update/read verb on the node) → clean failure, no row.
    return NextResponse.json({ message }, { status: 422 });
  }
}
