import type { Database, Json } from '@workspace/db';
import { createEntityId } from '@workspace/entity-id';
import {
  BODY_BRIDGE_SCHEMA_VERSION,
  bodyBridgeEnvelopeSchema,
  type BodyBridgeEnvelope,
  type BodyRef,
} from '@workspace/knowledge-contracts/body-bridge';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Payload, PayloadRequest } from 'payload';
import { createClient as createServiceClient } from '@supabase/supabase-js';

/**
 * Node↔body bridge — UI-AGNOSTIC application module (ADR-0005 guardrail b /
 * slice-03 §2.3–2.4). One author act = one fan-out: the authoritative node is
 * born in Postgres under the user's RLS, its Lexical body in Payload, linked
 * two-ways, with a durable outbox row as the reconcilable safety net. The Payload
 * admin-view is thin presentation that POSTs to the endpoint that calls THIS —
 * the view holds none of this logic, so a future shadcn port is a reskin.
 *
 * Discipline B: EVERY Postgres write of the fan-out (node INSERT, outbox enqueue,
 * body_ref UPDATE, edge INSERT) runs under the user's RLS-scoped `db`. service-
 * role appears ONLY in `reconcileBodyBridge` orphan repair, with an explicit
 * node-authority check.
 */

const BODIES_COLLECTION = 'bodies' as const;

export type FanoutEdgeInput = {
  relationType: 'prerequisite' | 'relates_to';
  toId: string; // existing node in the same space
};

/**
 * Containment placement for a freshly created node: a `contains` edge from a
 * parent folder to the new node (folder→child, FORWARD per ADR-0015). Used for
 * "create inside folder" / "move into folder". The edge is folder→child, so the
 * new node is the `to_id`; the folder is the `from_id`.
 */
export type ParentFolderPlacement = {
  parentFolderId: string; // knr_… of a kind=folder node in the same space
  position?: number;
};

export type CreateTextResourceInput = {
  spaceId: string;
  title: string;
  lexicalBody: unknown; // Lexical editor state (Payload richText value)
  edge?: FanoutEdgeInput;
  /** Optional containment: create the page inside this folder (contains edge). */
  parentFolder?: ParentFolderPlacement;
};

export type CreateTextResourceDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Payload Local API. */
  payload: Payload;
  /** Authenticated Supabase user id (created_by attribution). */
  userId: string;
  /** Payload request carrying the user identity for the Local API body create. */
  req: PayloadRequest;
};

export type CreateTextResourceResult = {
  node_id: string;
  body_ref: BodyRef;
  edge_id?: string;
  contains_edge_id?: string;
};

function buildLinkedEnvelope(input: {
  spaceId: string;
  nodeId: string;
  bodyRef: BodyRef;
}): BodyBridgeEnvelope {
  return {
    schema_version: BODY_BRIDGE_SCHEMA_VERSION,
    event: 'body.linked',
    space_id: input.spaceId,
    node_id: input.nodeId,
    body_ref: input.bodyRef,
  };
}

/**
 * Fan-out create (§2.3). Step order makes the AUTHORITY (node) first so any
 * partial failure leaves a reconcilable state visible from Postgres:
 *   1. INSERT node (kind=text) under RLS → node_id (authority).
 *   2. enqueue durable body.linked outbox row (node-owned) via the RLS seam.
 *   3. CREATE Payload body doc under the user identity (Local API).
 *   4. UPDATE node.body_ref under RLS (two-way link); self-heal sweep.
 *   5. (optional) INSERT one explicit edge under RLS — independent fact.
 */
export async function createTextResourceWithBody(
  input: CreateTextResourceInput,
  deps: CreateTextResourceDeps
): Promise<CreateTextResourceResult> {
  const { db, payload, userId, req } = deps;

  // ── step 1: authoritative node, under the user's RLS (created_by gate) ──────
  const { data: node, error: nodeErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: input.spaceId,
      kind: 'text',
      title: input.title,
      status: 'draft',
      created_by: userId,
      owner_user_id: userId,
    })
    .select('id,space_id')
    .single();
  if (nodeErr || !node?.id) {
    // Clean failure: nothing created (RLS rejected ⇒ no node, no body).
    throw new Error(
      `createTextResourceWithBody node: ${nodeErr?.message ?? 'no id'}`
    );
  }
  const nodeId = node.id;

  // ── step 3: Payload body doc under the user identity (Local API) ────────────
  // (Node-first authority is preserved: the node already exists in Postgres.)
  const bodyDoc = await payload.create({
    collection: BODIES_COLLECTION,
    req,
    overrideAccess: true, // birth is via fan-out only (create access = false)
    data: {
      // customIdPlugin runs in validate mode → mint the prefixed body id here.
      id: createEntityId('bod'),
      node_id: nodeId,
      space_id: input.spaceId,
      tenant: input.spaceId,
      body: input.lexicalBody as never,
    },
  });
  const bodyRef: BodyRef = {
    collection: BODIES_COLLECTION,
    doc_id: String(bodyDoc.id),
  };

  // ── step 2: durable outbox safety net — the validated body.linked envelope ──
  // (node-owned, via the RLS seam). Enqueued with the contract-shaped envelope
  // so the future async JetStream consumer claims THIS row and parses the
  // IDENTICAL `BodyBridgeEnvelope` — a seamless swap, no shape change.
  const envelope = buildLinkedEnvelope({
    spaceId: input.spaceId,
    nodeId,
    bodyRef,
  });
  await db.rpc('rpc_enqueue_body_bridge_job', {
    p_node_id: nodeId,
    p_payload: envelope as unknown as Json,
    p_idempotency_key: `body-bridge:${nodeId}`,
  });

  // ── step 4: two-way link + close the durable row (self-heal sweep) ──────────
  const { error: linkErr } = await db
    .from('knowledge_resources')
    .update({ body_ref: bodyRef as unknown as Json })
    .eq('id', nodeId);
  if (linkErr) {
    // body exists, body_ref not set → reconcilable (saga). Surface the failure;
    // a self-heal pass can re-link by node_id (idempotent).
    throw new Error(`createTextResourceWithBody link: ${linkErr.message}`);
  }

  // ── step 5: optional explicit edge (independent reconcilable fact) ──────────
  // Reuses the shared RLS-scoped edge seam (insertEdge) — same created_by-from-
  // session, same verb gate on the row. Edge failure does NOT roll back the body.
  let edgeId: string | undefined;
  if (input.edge) {
    const edge = await insertEdge(
      {
        spaceId: input.spaceId,
        fromId: nodeId,
        toId: input.edge.toId,
        relationType: input.edge.relationType,
      },
      { db, userId }
    );
    edgeId = edge.edge_id;
  }

  // ── step 6: optional containment placement (contains folder→page, ADR-0015) ─
  let containsEdgeId: string | undefined;
  if (input.parentFolder) {
    const placed = await insertEdge(
      {
        spaceId: input.spaceId,
        fromId: input.parentFolder.parentFolderId,
        toId: nodeId,
        relationType: 'contains',
        position: input.parentFolder.position,
      },
      { db, userId }
    );
    containsEdgeId = placed.edge_id;
  }

  return {
    node_id: nodeId,
    body_ref: bodyRef,
    edge_id: edgeId,
    contains_edge_id: containsEdgeId,
  };
}

// ── body-less node create (link/tag/folder) — fan-out branch, NO Payload body ─
// ADR-0002 §3: only `kind=text` is born through Payload. `link`/`tag`/`folder`
// nodes carry no Lexical body, so there is no Payload doc, no body_ref, and no
// body-bridge outbox row (the outbox is body-only). This is therefore SIMPLER
// than the text fan-out: a single RLS-scoped INSERT into knowledge_resources
// (created_by / owner_user_id from the session, NEVER the body) + an optional
// starting edge, exactly mirroring the text fan-out's step-1 and step-5 RLS seams.
//
// `folder` (ADR-0015) is a pure container kind: a body-less node whose children
// are reached via FORWARD `contains` edges. "Create inside folder" is the same
// body-less INSERT plus a `contains` edge (folder→new node) — expressed via
// `parentFolderId`.

// `file`/`video` are also body-less in this slice: the node + its media-meta
// satellite carry the resource; the real binary upload + Storage is a deferred
// slice (poc-no-fallbacks — the create writes a REAL node, just no asset yet).
export type BodylessKind = 'link' | 'tag' | 'folder' | 'file' | 'video';

export type CreateBodylessResourceInput = {
  spaceId: string;
  kind: BodylessKind;
  title: string;
  edge?: FanoutEdgeInput;
  /** Optional containment: create the node inside this folder (contains edge). */
  parentFolder?: ParentFolderPlacement;
};

export type CreateBodylessResourceDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (created_by / owner attribution). */
  userId: string;
};

export type CreateBodylessResourceResult = {
  node_id: string;
  kind: BodylessKind;
  edge_id?: string;
  contains_edge_id?: string;
};

/**
 * Create a body-less graph node (`link`/`tag`) under the user's RLS. The verb gate
 * (`space.knowledge.create`) is enforced by RLS on the INSERT itself — a caller
 * without it gets a clean failure (no row), not an application-level check. The
 * authoritative node is the only artifact: no Payload doc, no outbox.
 */
export async function createBodylessResource(
  input: CreateBodylessResourceInput,
  deps: CreateBodylessResourceDeps
): Promise<CreateBodylessResourceResult> {
  const { db, userId } = deps;

  const { data: node, error: nodeErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: input.spaceId,
      kind: input.kind,
      title: input.title,
      status: 'active',
      created_by: userId,
      owner_user_id: userId,
    })
    .select('id')
    .single();
  if (nodeErr || !node?.id) {
    // Clean failure: RLS rejected (no space.knowledge.create) ⇒ no node.
    throw new Error(
      `createBodylessResource node: ${nodeErr?.message ?? 'no id'}`
    );
  }
  const nodeId = node.id;

  let edgeId: string | undefined;
  if (input.edge) {
    const edge = await insertEdge(
      {
        spaceId: input.spaceId,
        fromId: nodeId,
        toId: input.edge.toId,
        relationType: input.edge.relationType,
      },
      { db, userId }
    );
    edgeId = edge.edge_id;
  }

  // Optional containment placement: FORWARD `contains` edge folder→new node
  // (ADR-0015). The new node is the child (to_id); the folder is the from_id.
  let containsEdgeId: string | undefined;
  if (input.parentFolder) {
    const placed = await insertEdge(
      {
        spaceId: input.spaceId,
        fromId: input.parentFolder.parentFolderId,
        toId: nodeId,
        relationType: 'contains',
        position: input.parentFolder.position,
      },
      { db, userId }
    );
    containsEdgeId = placed.edge_id;
  }

  return {
    node_id: nodeId,
    kind: input.kind,
    edge_id: edgeId,
    contains_edge_id: containsEdgeId,
  };
}

// ── rename (title update) — RLS-scoped, verb gate on the UPDATE ───────────────

export type RenameResourceInput = {
  spaceId: string;
  resourceId: string; // knr_…
  title: string;
};

/**
 * Rename a node's title under the user's RLS (`space.knowledge.update` enforced by
 * RLS on the UPDATE, never an application check). space_id scopes the row; the
 * caller's identity is the RLS context, never the body. Returns the new title.
 */
export async function renameResource(
  input: RenameResourceInput,
  deps: { db: SupabaseClient<Database> }
): Promise<{ node_id: string; title: string }> {
  const { db } = deps;
  const { data, error } = await db
    .from('knowledge_resources')
    .update({ title: input.title })
    .eq('id', input.resourceId)
    .eq('space_id', input.spaceId)
    .select('id,title')
    .single();
  if (error || !data?.id) {
    // RLS rejection (no update verb) / not-found → clean failure.
    throw new Error(`renameResource: ${error?.message ?? 'not found'}`);
  }
  return { node_id: data.id, title: data.title };
}

// ── edge-write (relates_to / tagged / contains / shortcut, create + delete) ───
// §3.6 / §8.4 Variant A: edge-write is the natural extension of this module (it
// already owns the RLS-scoped edge INSERT at the text fan-out step 5). The
// consumer surface authors:
//   - `relates_to` (associative link, NodePicker),
//   - `tagged`     (resource→tag, TagEditor),
//   - `contains`   (folder→child, FORWARD containment — ADR-0015; create-inside /
//                   move-into-folder),
//   - `shortcut`   (folder→target, Drive cross-folder symlink — ADR-0015).
// `part_of`/`prerequisite` stay structural and out of this slice's write scope.
// `contains` direction is ALWAYS folder→child (from_id=folder, to_id=child); the
// route/caller is responsible for passing the folder as `fromId`.

export const AUTHORABLE_RELATION_TYPES = [
  'relates_to',
  'tagged',
  'contains',
  'shortcut',
] as const;
export type AuthorableRelationType = (typeof AUTHORABLE_RELATION_TYPES)[number];

export type InsertEdgeInput = {
  spaceId: string;
  fromId: string;
  toId: string;
  relationType: FanoutEdgeInput['relationType'] | AuthorableRelationType;
  position?: number;
};

/**
 * Shared RLS-scoped edge INSERT seam (reused by the text fan-out step 5, body-less
 * create, and the edge-write route). `created_by` is the SESSION user id, never the
 * body. The verb gate (`space.knowledge.create`) is on the row via RLS; the
 * same-space guard trigger keeps from/to in the edge's space.
 */
async function insertEdge(
  input: InsertEdgeInput,
  deps: { db: SupabaseClient<Database>; userId: string }
): Promise<{ edge_id: string }> {
  const { db, userId } = deps;
  const { data: edge, error } = await db
    .from('knowledge_edges')
    .insert({
      space_id: input.spaceId,
      from_id: input.fromId,
      to_id: input.toId,
      relation_type: input.relationType,
      position: input.position ?? 0,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error || !edge?.id) {
    throw new Error(`insertEdge: ${error?.message ?? 'no id'}`);
  }
  return { edge_id: edge.id };
}

export type CreateEdgeInput = {
  spaceId: string;
  fromId: string;
  toId: string;
  relationType: AuthorableRelationType;
  position?: number;
};

/**
 * Create an associative (`relates_to`) or tagging (`tagged`) edge under the user's
 * RLS. Idempotent against the `(from_id,to_id,relation_type)` unique index: a
 * duplicate is treated as success (the edge already exists), so a double-tag /
 * double-link is a no-op rather than a hard error.
 */
export async function createEdge(
  input: CreateEdgeInput,
  deps: { db: SupabaseClient<Database>; userId: string }
): Promise<{ edge_id: string; created: boolean }> {
  const { db, userId } = deps;
  const { data: edge, error } = await db
    .from('knowledge_edges')
    .insert({
      space_id: input.spaceId,
      from_id: input.fromId,
      to_id: input.toId,
      relation_type: input.relationType,
      position: input.position ?? 0,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error) {
    // Unique-violation on (from_id,to_id,relation_type) → edge already exists.
    // Resolve the existing edge under the same RLS context and report it.
    if (error.code === '23505') {
      const { data: existing } = await db
        .from('knowledge_edges')
        .select('id')
        .eq('space_id', input.spaceId)
        .eq('from_id', input.fromId)
        .eq('to_id', input.toId)
        .eq('relation_type', input.relationType)
        .maybeSingle();
      if (existing?.id) {
        return { edge_id: existing.id, created: false };
      }
    }
    // RLS rejection (no create verb) / FK / same-space guard → clean failure.
    throw new Error(`createEdge: ${error.message}`);
  }
  if (!edge?.id) {
    throw new Error('createEdge: no id');
  }
  return { edge_id: edge.id, created: true };
}

export type DeleteEdgeInput = {
  spaceId: string;
} & (
  | { edgeId: string }
  | {
      fromId: string;
      toId: string;
      relationType: AuthorableRelationType;
    }
);

/**
 * Delete an edge (unlink / untag) under the user's RLS (`space.knowledge.delete`
 * enforced by RLS on the DELETE). Either by edge id, or by the
 * (from_id,to_id,relation_type) triple (the natural key the untag/unlink UI holds).
 * Returns how many rows the user's RLS context actually deleted (0 = nothing
 * visible/permitted — a clean no-op, not an error).
 */
export async function deleteEdge(
  input: DeleteEdgeInput,
  deps: { db: SupabaseClient<Database> }
): Promise<{ deleted: number }> {
  const { db } = deps;
  let query = db.from('knowledge_edges').delete().eq('space_id', input.spaceId);
  if ('edgeId' in input) {
    query = query.eq('id', input.edgeId);
  } else {
    query = query
      .eq('from_id', input.fromId)
      .eq('to_id', input.toId)
      .eq('relation_type', input.relationType);
  }
  const { data, error } = await query.select('id');
  if (error) {
    throw new Error(`deleteEdge: ${error.message}`);
  }
  return { deleted: data?.length ?? 0 };
}

// ── tag-on-tagging two-step (ensure tag node, then tagged edge) — RLS-scoped ──

export type TagResourceInput = {
  spaceId: string;
  resourceId: string; // knr_… resource being tagged (edge from_id)
  // Either an existing tag node id, or a new tag title to create first.
  tagId?: string;
  tagTitle?: string;
};

/**
 * Tag a resource (`tagged` edge from_id=resource → to_id=tag) under the user's RLS.
 * Two-step mutation: if no `tagId` is given, first create the `kind='tag'` node
 * (body-less), then the `tagged` edge — both under RLS, both verb-gated on the row.
 * Idempotent at the edge step (re-tagging an existing tag is a no-op). Order: node
 * before edge so a partial failure leaves a reconcilable tag node (orphan tag is
 * harmless; the edge is the meaning).
 */
export async function tagResource(
  input: TagResourceInput,
  deps: { db: SupabaseClient<Database>; userId: string }
): Promise<{ tag_id: string; edge_id: string; tag_created: boolean }> {
  const { db, userId } = deps;

  let tagId = input.tagId;
  let tagCreated = false;
  if (!tagId) {
    if (!input.tagTitle) {
      throw new Error('tagResource: tagId or tagTitle required');
    }
    const created = await createBodylessResource(
      { spaceId: input.spaceId, kind: 'tag', title: input.tagTitle },
      { db, userId }
    );
    tagId = created.node_id;
    tagCreated = true;
  }

  const edge = await createEdge(
    {
      spaceId: input.spaceId,
      fromId: input.resourceId,
      toId: tagId,
      relationType: 'tagged',
    },
    { db, userId }
  );

  return { tag_id: tagId, edge_id: edge.edge_id, tag_created: tagCreated };
}

// ── reconciliation (§2.4) — node is the authority ────────────────────────────

export type ReconcileDeps = {
  /** User's RLS client (read node state, re-link body_ref). */
  db: SupabaseClient<Database>;
  payload: Payload;
  req: PayloadRequest;
};

export type ReconcileResult = {
  relinked: boolean;
  orphanRemoved: boolean;
  body_ref?: BodyRef;
};

function serviceSupabase(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRole) {
    return null;
  }
  return createServiceClient<Database>(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Reconcile the bridge state for one node (idempotent by node_id). The node is
 * the truth (ADR-0002 §1):
 *  - node exists but body_ref is null → find the body by node_id, set body_ref
 *    under the user's RLS client (the self-heal swap for a crash between step 3
 *    and 4).
 *  - node is GONE → the body is an orphan; remove it. The only place service-role
 *    is allowed (systemic orphan repair), and only after confirming — via the
 *    SAME service client — that no node with that id exists (explicit
 *    node-authority check). The user's RLS client cannot prove a node's absence
 *    (RLS hides it either way), so this systemic check needs service-role.
 */
export async function reconcileBodyBridge(
  nodeId: string,
  deps: ReconcileDeps
): Promise<ReconcileResult> {
  const { db, payload, req } = deps;

  const bodies = await payload.find({
    collection: BODIES_COLLECTION,
    where: { node_id: { equals: nodeId } },
    req,
    overrideAccess: true,
    depth: 0,
    limit: 1,
  });
  const bodyDoc = bodies.docs[0];

  // Is the node alive under the caller's RLS?
  const { data: node } = await db
    .from('knowledge_resources')
    .select('id,kind,body_ref')
    .eq('id', nodeId)
    .maybeSingle();

  if (node?.id) {
    // Node alive + body present → ensure the two-way link (self-heal).
    if (bodyDoc) {
      const bodyRef: BodyRef = {
        collection: BODIES_COLLECTION,
        doc_id: String(bodyDoc.id),
      };
      const current = node.body_ref as unknown as BodyRef | null;
      if (!current || current.doc_id !== bodyRef.doc_id) {
        const { error } = await db
          .from('knowledge_resources')
          .update({ body_ref: bodyRef as unknown as Json })
          .eq('id', nodeId);
        if (error) {
          throw new Error(`reconcileBodyBridge relink: ${error.message}`);
        }
        return { relinked: true, orphanRemoved: false, body_ref: bodyRef };
      }
      return { relinked: false, orphanRemoved: false, body_ref: bodyRef };
    }
    return { relinked: false, orphanRemoved: false };
  }

  // Node not visible under RLS. Confirm SYSTEMICALLY (service-role) that it is
  // truly gone before deleting the orphan body — node is the authority.
  if (bodyDoc) {
    const service = serviceSupabase();
    const { data: systemicNode } = service
      ? await service
          .from('knowledge_resources')
          .select('id')
          .eq('id', nodeId)
          .maybeSingle()
      : { data: null };

    if (!systemicNode?.id) {
      // body.unlinked → remove the orphan Payload doc.
      await payload.delete({
        collection: BODIES_COLLECTION,
        id: String(bodyDoc.id),
        req,
        overrideAccess: true,
      });
      return { relinked: false, orphanRemoved: true };
    }
  }

  return { relinked: false, orphanRemoved: false };
}

/** Re-export the envelope validator for endpoint-boundary parity. */
export { bodyBridgeEnvelopeSchema };
