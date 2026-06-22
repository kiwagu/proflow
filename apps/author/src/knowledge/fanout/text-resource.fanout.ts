import type { Database } from '@workspace/db';
import { createEntityId } from '@workspace/entity-id';
import type { BodyRef } from '@workspace/knowledge-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Payload } from 'payload';

/**
 * Text-resource authoring — the ONE node kind that carries a Lexical body
 * (ADR-0002 §1, ADR-0005). A `kind=text` create is a cross-store fan-out: the
 * authoritative node lives in Postgres (under RLS), the Lexical body lives in
 * the Payload `bodies` collection (Mongo). The two are bridged by
 * `knowledge_resources.body_ref = { collection:'bodies', doc_id }` (the column
 * pre-exists in the frozen graph schema — this is an UPDATE, never DDL).
 *
 * SYNCHRONOUS by construction: a create has no contention and no back-pressure,
 * so the body is written inline and the document is immediately consistent —
 * the read-path needs nothing async. The durable outbox `body.linked` job + a
 * JetStream reconciler are a SEPARATE later concern (slice-08); enqueuing here
 * would fire pgmq into a body handler that does not yet exist (a broken
 * fallback, poc-no-fallbacks). So A1 ships none of that.
 *
 * Authority: the node INSERT is gated by Postgres RLS (`space.knowledge.create`,
 * `created_by` pinned to the session) exactly like a body-less create; the body
 * is born only through this fan-out's Local API `create` with `overrideAccess`
 * (Bodies.create is closed to the admin UI). Every Postgres write runs under the
 * user's RLS-scoped `db` — never service-role.
 *
 * Consistency: ALL-OR-NOTHING. No reconciler exists to heal a half-write, so any
 * failure after the node INSERT is compensated by deleting what was created (the
 * body, then the node — the node delete also cascades its `contains` edge via
 * FK). The caller sees a clean failure with zero orphans.
 */

/** The minimal empty Lexical root the `bodies` richText field accepts. Empty-
 * but-live: a new text node owns a real, readable (blank) body until the editor
 * lands. The default lives here so callers need not supply one. */
const EMPTY_LEXICAL = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [
      {
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        textFormat: 0,
        children: [],
      },
    ],
  },
} as const;

/** Containment placement: a FORWARD `contains` edge folder→child (ADR-0015). */
export type TextParentFolderPlacement = {
  parentFolderId: string; // knr_… of a kind=folder node in the same space
  position?: number;
};

export type CreateTextResourceInput = {
  spaceId: string;
  title: string;
  /** Lexical body to seed the document with. Defaults to an empty body. */
  lexicalBody?: unknown;
  /** Optional containment: create the node inside this folder (contains edge). */
  parentFolder?: TextParentFolderPlacement;
};

export type CreateTextResourceDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (created_by attribution). */
  userId: string;
  /** Payload Local API instance (for the `bodies` doc create/compensation). */
  payload: Payload;
};

export type CreateTextResourceResult = {
  node_id: string;
  body_ref: BodyRef;
};

/**
 * Create a `kind=text` node and its Lexical body, bridged by `body_ref`, under
 * the user's RLS. Compensates by deletion on any post-INSERT failure.
 */
export async function createTextResource(
  input: CreateTextResourceInput,
  deps: CreateTextResourceDeps
): Promise<CreateTextResourceResult> {
  const { db, userId, payload } = deps;

  // 1. Authoritative node INSERT under the caller's RLS (clean failure ⇒ no row
  //    when the caller lacks space.knowledge.create).
  const { data: node, error: nodeErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: input.spaceId,
      kind: 'text',
      title: input.title,
      status: 'active',
      created_by: userId,
      owner_user_id: userId,
    })
    .select('id')
    .single();
  if (nodeErr || !node?.id) {
    throw new Error(`createTextResource node: ${nodeErr?.message ?? 'no id'}`);
  }
  const nodeId = node.id;

  // 2. Optional containment placement: FORWARD `contains` edge folder→new node
  //    (ADR-0015). On failure compensate the node (its delete is the only thing
  //    persisted so far).
  if (input.parentFolder) {
    const { error: edgeErr } = await db.from('knowledge_edges').insert({
      space_id: input.spaceId,
      from_id: input.parentFolder.parentFolderId,
      to_id: nodeId,
      relation_type: 'contains',
      position: input.parentFolder.position ?? 0,
      created_by: userId,
    });
    if (edgeErr) {
      await deleteNode(db, input.spaceId, nodeId);
      throw new Error(`createTextResource contains: ${edgeErr.message}`);
    }
  }

  // 3. Lexical body in Payload (the body is born only here, via overrideAccess
  //    after the node passed RLS). On failure compensate the node (FK cascades
  //    the contains edge).
  let docId: string;
  try {
    const doc = await payload.create({
      collection: 'bodies',
      overrideAccess: true,
      data: {
        // The `bodies` collection uses customIdPlugin in `validate` mode — the
        // id must be supplied (it is not auto-minted). Mint the canonical
        // `bod_…` entity id the plugin would otherwise generate.
        id: createEntityId('bod'),
        node_id: nodeId,
        space_id: input.spaceId,
        body: (input.lexicalBody ?? EMPTY_LEXICAL) as never,
      },
    });
    docId = String(doc.id);
  } catch (error) {
    await deleteNode(db, input.spaceId, nodeId);
    const message = error instanceof Error ? error.message : 'body create';
    throw new Error(`createTextResource body: ${message}`, { cause: error });
  }

  // 4. Bridge the node to its body (UPDATE on the pre-existing body_ref column).
  //    On failure compensate BOTH the body and the node.
  const bodyRef: BodyRef = { collection: 'bodies', doc_id: docId };
  const { error: refErr } = await db
    .from('knowledge_resources')
    .update({ body_ref: bodyRef })
    .eq('id', nodeId)
    .eq('space_id', input.spaceId);
  if (refErr) {
    await deleteBody(payload, docId);
    await deleteNode(db, input.spaceId, nodeId);
    throw new Error(`createTextResource body_ref: ${refErr.message}`);
  }

  return { node_id: nodeId, body_ref: bodyRef };
}

export type EnsureNodeBodyInput = {
  nodeId: string;
  spaceId: string;
};

export type EnsureNodeBodyDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Payload Local API instance. */
  payload: Payload;
};

/**
 * Resolve a text node's body doc id, SELF-HEALING if absent: a node created
 * before the body fan-out existed (or any bodyless `kind=text` node) gets a real
 * empty body minted on demand, bridged via `body_ref`, so every document is
 * editable. The caller MUST have already gated node access under RLS. Returns the
 * Payload `bodies` doc id.
 */
export async function ensureNodeBody(
  input: EnsureNodeBodyInput,
  deps: EnsureNodeBodyDeps
): Promise<string> {
  const { db, payload } = deps;

  // Resolve the body doc from the MAIN collection (NOT `draft: true`, which queries
  // the versions view keyed on the `latest` flag). A pruned latest version leaves
  // the draft view empty even though the body doc still exists — using the main
  // collection avoids a spurious re-create that would hit the `node_id` unique key.
  const existing = await payload.find({
    collection: 'bodies',
    where: { node_id: { equals: input.nodeId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
    pagination: false,
  });
  const found = existing.docs[0] as { id?: string } | undefined;
  if (found?.id) {
    return String(found.id);
  }

  const doc = await payload.create({
    collection: 'bodies',
    overrideAccess: true,
    data: {
      id: createEntityId('bod'),
      node_id: input.nodeId,
      space_id: input.spaceId,
      body: EMPTY_LEXICAL as never,
    },
  });
  const docId = String(doc.id);

  const bodyRef: BodyRef = { collection: 'bodies', doc_id: docId };
  await db
    .from('knowledge_resources')
    .update({ body_ref: bodyRef })
    .eq('id', input.nodeId)
    .eq('space_id', input.spaceId);

  return docId;
}

/** Best-effort compensation: drop the node (FK cascades its edges). */
async function deleteNode(
  db: SupabaseClient<Database>,
  spaceId: string,
  nodeId: string
): Promise<void> {
  await db
    .from('knowledge_resources')
    .delete()
    .eq('id', nodeId)
    .eq('space_id', spaceId);
}

/** Best-effort compensation: drop the orphaned Payload body. */
async function deleteBody(payload: Payload, docId: string): Promise<void> {
  try {
    await payload.delete({
      collection: 'bodies',
      id: docId,
      overrideAccess: true,
    });
  } catch {
    // Compensation is best-effort; the caller already fails the request.
  }
}
