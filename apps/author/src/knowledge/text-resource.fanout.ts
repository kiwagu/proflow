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

export type CreateTextResourceInput = {
  spaceId: string;
  title: string;
  lexicalBody: unknown; // Lexical editor state (Payload richText value)
  edge?: FanoutEdgeInput;
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
  let edgeId: string | undefined;
  if (input.edge) {
    const { data: edge, error: edgeErr } = await db
      .from('knowledge_edges')
      .insert({
        space_id: input.spaceId,
        from_id: nodeId,
        to_id: input.edge.toId,
        relation_type: input.edge.relationType,
        position: 0,
        created_by: userId,
      })
      .select('id')
      .single();
    if (edgeErr || !edge?.id) {
      // Edge failure does NOT roll back the body (step 5 note). Surface it.
      throw new Error(
        `createTextResourceWithBody edge: ${edgeErr?.message ?? 'no id'}`
      );
    }
    edgeId = edge.id;
  }

  return { node_id: nodeId, body_ref: bodyRef, edge_id: edgeId };
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
