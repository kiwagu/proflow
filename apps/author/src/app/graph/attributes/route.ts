import { entityIds } from '@workspace/entity-id';
import { linkUrlSchema } from '@workspace/knowledge-contracts';
import { z } from 'zod';
import { NextResponse } from 'next/server';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  setResourceDescription,
  setResourceLink,
  setResourceMedia,
} from '@/knowledge/fanout';

/**
 * KB application-attribute write for the consumer authoring surface.
 *
 * One thin route for ALL node satellites, discriminated by `attribute` — every
 * satellite is the SAME operation shape (a 1:1 UPSERT keyed by node_id under the
 * SAME RLS verb mirror), so they share identical session/zod/delegate plumbing.
 * Landed: `description`, `link` (slice-10 §2.4), `media`; new attributes are a
 * one-line schema member + case as their satellites land. The write LOGIC lives in
 * the UI-agnostic kb-attribute.fanout module; this route only validates + delegates.
 *
 * Auth: the Supabase SESSION under `/author/graph/*`. RLS is the SOLE write
 * authority — satellite policies mirror the parent node's access (write =
 * `space.knowledge.update`). `created_by` comes from the SESSION, never the body.
 */

export const dynamic = 'force-dynamic';

const descriptionSchema = z.object({
  attribute: z.literal('description'),
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema,
  body: z.string(),
});

// The CONFIRM leg of a media upload: written ONLY after the bytes
// landed in the `kb-media` bucket. The kmm reference is `{nodeId → blobId}` (the
// blob was reserved at authorize and carries the byte-intrinsic fields); the
// optional client-computed `checksum` is a write-once blob extra. Mirrors
// `SetResourceMediaRequest` — `createdBy` is NOT here (it comes from the SESSION).
const mediaSchema = z.object({
  attribute: z.literal('media'),
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema,
  blobId: entityIds.kbMediaBlob.prefixSchema,
  originalFilename: z.string().min(1),
  checksum: z.string().nullable().optional(),
});

// The URL of a `kind=link` node (slice-10 §2.4) — `linkUrlSchema` is the http(s)-
// only allow-list (anti stored-XSS: the URL renders as an href). `host` is NOT
// accepted from the client — the server derives it from the validated URL.
const linkSchema = z.object({
  attribute: z.literal('link'),
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema,
  url: linkUrlSchema,
});

const postSchema = z.discriminatedUnion('attribute', [
  descriptionSchema,
  linkSchema,
  mediaSchema,
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
      case 'link': {
        const result = await setResourceLink(
          { spaceId: d.spaceId, nodeId: d.nodeId, url: d.url },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      case 'media': {
        const result = await setResourceMedia(
          {
            spaceId: d.spaceId,
            nodeId: d.nodeId,
            blobId: d.blobId,
            originalFilename: d.originalFilename,
            checksum: d.checksum,
          },
          { db, userId }
        );
        return NextResponse.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }
    // exhaustive over the union today; future attributes add a case above.
    return NextResponse.json(
      { message: 'Unsupported attribute.' },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Attribute write failed.';
    // RLS rejection (no update verb on the node) → clean failure, no row.
    return NextResponse.json({ message }, { status: 422 });
  }
}
