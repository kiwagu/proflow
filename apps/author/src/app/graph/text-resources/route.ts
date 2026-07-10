import { entityIds } from '@workspace/entity-id';
import config from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import { z } from 'zod';

import { createTextResource, ensureNodeBody } from '@/knowledge/fanout';
import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * Text-resource write for the consumer authoring surface — the ONE node kind
 * that carries a Lexical body (ADR-0002 §1, ADR-0005).
 *
 * GET  — read a node's Lexical body for READ MODE: the LATEST PUBLISHED version
 *        ONLY (never a draft or an older approved revision). The cross-store RLS
 *        gate (ADR-0002 §2): first resolve node access under the user's OWN RLS
 *        (a PostgREST select on `knowledge_resources` — no row ⇒ no access ⇒ 404),
 *        THEN read the `bodies` doc by `node_id` via the Payload Local API with
 *        `overrideAccess` (the gate already passed). Body access is subordinate
 *        to node access — never a second authority.
 *        Drafts and past versions are deliberately NOT served here — they stay
 *        reachable for EDITING (the editor route loads the latest draft) and via
 *        the version-preview modal, so a double-click never surfaces un-approved
 *        material. A node with no published version yet returns
 *        `{ body: null, status: null, published: false }`.
 * POST — create a `kind=text` node + its Payload `bodies` doc, bridged by
 *        `body_ref`, optionally placed inside a folder (FORWARD `contains`
 *        edge, ADR-0015). A SYNCHRONOUS cross-store fan-out: the node INSERT is
 *        gated by Postgres RLS (`space.knowledge.create`) under the user's
 *        session; the body is born via the Payload Local API. All-or-nothing —
 *        a post-INSERT failure is compensated by deletion (see the fan-out).
 * PATCH — save the Lexical body from the in-workbench editor. Gate node access
 *        under RLS, resolve (self-healing) the body doc, then `payload.update`
 *        the `body` field — which records a VERSION (Payload versions fire on any
 *        update, not only the admin form). The editor is the workbench's own
 *        embeddable Lexical; the storage + versioning stay Payload's.
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

  // Resolve the body doc by node_id (the bridge key; unique in `bodies`) from the
  // MAIN collection — NOT the `draft: true` versions view, which goes empty if the
  // `latest` version was pruned. The main row also carries `_status`: the document's
  // CURRENT publish state, which a draft save leaves at `published` but Unpublish
  // flips back to `draft` — so it gates whether read mode shows anything.
  const payload = await getPayload({ config });
  const { docs } = await payload.find({
    collection: 'bodies',
    where: { node_id: { equals: nodeId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
    pagination: false,
  });
  const mainDoc = docs[0] as { id?: string; _status?: string } | undefined;
  const bodyDocId = mainDoc?.id ?? null;
  // Read mode shows content ONLY while the document is CURRENTLY published. A doc
  // that was never published, is draft-only, or was Unpublished → nothing here
  // (drafts/old revisions stay reachable for editing, not for reading).
  const isPublished = mainDoc?._status === 'published';

  // The body is the latest PUBLISHED version (querying versions is deterministic,
  // unlike the main row's body which a draft save may have moved on). We also note
  // whether the doc was EVER published — to tell "never published" apart from
  // "was published, now Unpublished" for an honest read-mode notice.
  let publishedBody: unknown = null;
  let everPublished = false;
  if (bodyDocId) {
    const { docs: versions } = await payload.findVersions({
      collection: 'bodies',
      where: {
        and: [
          { parent: { equals: bodyDocId } },
          { 'version._status': { equals: 'published' } },
        ],
      },
      overrideAccess: true,
      depth: 0,
      limit: 1,
      sort: '-updatedAt',
      pagination: false,
    });
    const latest = versions[0] as { version?: { body?: unknown } } | undefined;
    if (latest) {
      everPublished = true;
      publishedBody = latest.version?.body ?? null;
    }
  }

  // Read mode shows the published body ONLY while the doc is CURRENTLY published.
  const hasPublished = isPublished && everPublished;

  return NextResponse.json(
    {
      node_id: nodeId,
      body: hasPublished ? publishedBody : null,
      status: hasPublished ? 'published' : null,
      published: hasPublished,
      // distinguishes "never published" from "retracted" for the reader notice
      everPublished,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

const parentFolderSchema = z.object({
  parentFolderId: entityIds.knowledgeResource.prefixSchema,
  position: z.number().int().min(0).optional(),
});

const createSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
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

const updateSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema, // knr_…
  // A Lexical SerializedEditorState ({ root }). OMIT for a status-only change:
  //   - status:'draft'     → UNPUBLISH (retract to draft; body unchanged),
  //   - status:'published' → publish the current state (no body change).
  body: z.unknown().optional(),
  // 'draft' saves a draft version; 'published' promotes it (Payload drafts).
  status: z.enum(['draft', 'published']).default('draft'),
});

export async function PATCH(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(raw);
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

  // Gate: a text node the caller may access under RLS (no row ⇒ no access).
  const { data: node, error: nodeErr } = await db
    .from('knowledge_resources')
    .select('id')
    .eq('id', parsed.data.nodeId)
    .eq('space_id', parsed.data.spaceId)
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

  try {
    const payload = await getPayload({ config });
    // Self-heal a missing body, then write — `update` records a version.
    const docId = await ensureNodeBody(
      { nodeId: parsed.data.nodeId, spaceId: parsed.data.spaceId },
      { db, payload }
    );
    const isDraft = parsed.data.status === 'draft';
    const hasBody = parsed.data.body !== undefined;
    // With a body: save a draft version, or save + publish. Without a body, it is
    // a STATUS-only change on the main doc — Unpublish (→ draft) or publish the
    // current state (→ published) — never a draft version (`draft: false`).
    const data = (
      hasBody
        ? isDraft
          ? { body: parsed.data.body }
          : { body: parsed.data.body, _status: 'published' }
        : { _status: parsed.data.status }
    ) as never;
    await payload.update({
      collection: 'bodies',
      id: docId,
      data,
      draft: hasBody ? isDraft : false,
      overrideAccess: true,
    });
    return NextResponse.json(
      { ok: true, status: parsed.data.status },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Body save failed.';
    return NextResponse.json({ message }, { status: 422 });
  }
}
