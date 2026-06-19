import type { Database } from '@workspace/db';
import type {
  ProvenanceSource,
  ResourceActivity,
  ResourceDescription,
  ResourceLink,
  ResourceMediaMeta,
  ResourceProvenance,
} from '@workspace/kb-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

import { kbSchema } from '@/lib/supabase/kb-schema';

/**
 * KB application-attribute write module — UI-AGNOSTIC (ADR-0005 guardrail b /
 * ADR-0011 §4). Each KB attribute is a per-node SATELLITE in the dedicated `kb`
 * schema (ADR-0013): a 1:1 row keyed by `node_id`. These functions are the
 * write seam for those satellites; the route is a thin transport wrapper and the
 * view holds none of this logic (a future port is a reskin).
 *
 * Trust discipline (ADR-0011 §3, non-negotiable):
 *  - EVERY write runs under the user's RLS-scoped `db` (never service-role).
 *  - The verb gate (`space.knowledge.update`, or `read` for the view counter) is
 *    enforced by RLS on the satellite row — it mirrors the parent node's access
 *    via the landed `auth_user_can_access_resource` helper. A caller without the
 *    verb gets a clean failure (no row), not an application-level check.
 *  - `created_by` is the SESSION user id, never the request body.
 *  - `space_id` is validated against the node by the satellite same-space guard
 *    trigger; we pass it through but the DB is the authority.
 *
 * satellites-only (ADR-0013 §2): each function touches ONE attribute table keyed
 * by node_id. There is no relationship between satellite rows — any relationship
 * between nodes is a `knowledge_edges` row. Invariant #1 holds.
 *
 * Idempotency: the satellites are 1:1 (UNIQUE node_id), so set/update is an UPSERT
 * on `node_id` — a second set of the same attribute updates in place rather than
 * inserting a duplicate.
 */

const ON_NODE_ID = 'node_id' as const;

export type KbAttributeDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (created_by attribution). */
  userId: string;
};

// ── description (krd) — RAG-bound text on any kind ───────────────────────────

export type SetResourceDescriptionInput = {
  spaceId: string;
  nodeId: string;
  body: string;
};

/**
 * Set/update a node's description (UPSERT by node_id). RLS write =
 * `space.knowledge.update` (editing a node attribute). The description text is the
 * field a future RAG vector seam will embed; the text is stored now, the vector is
 * not (poc-no-fallbacks).
 */
export async function setResourceDescription(
  input: SetResourceDescriptionInput,
  deps: KbAttributeDeps
): Promise<ResourceDescription> {
  const { db, userId } = deps;
  const { data, error } = await kbSchema(db)
    .from('resource_description')
    .upsert(
      {
        node_id: input.nodeId,
        space_id: input.spaceId,
        body: input.body,
        created_by: userId,
      },
      { onConflict: ON_NODE_ID }
    )
    .select('node_id,body')
    .single();
  if (error || !data) {
    // RLS rejection (no update verb / node not accessible) → clean failure.
    throw new Error(`setResourceDescription: ${error?.message ?? 'no row'}`);
  }
  return { node_id: data.node_id, body: data.body };
}

// ── provenance (krp) — source human/imported/ai ──────────────────────────────

export type SetResourceProvenanceInput = {
  spaceId: string;
  nodeId: string;
  source: ProvenanceSource;
};

/**
 * Set/update a node's provenance source (UPSERT by node_id). RLS write =
 * `space.knowledge.update`.
 */
export async function setResourceProvenance(
  input: SetResourceProvenanceInput,
  deps: KbAttributeDeps
): Promise<ResourceProvenance> {
  const { db } = deps;
  const { data, error } = await kbSchema(db)
    .from('resource_provenance')
    .upsert(
      {
        node_id: input.nodeId,
        space_id: input.spaceId,
        source: input.source,
      },
      { onConflict: ON_NODE_ID }
    )
    .select('node_id,source')
    .single();
  if (error || !data) {
    throw new Error(`setResourceProvenance: ${error?.message ?? 'no row'}`);
  }
  return { node_id: data.node_id, source: data.source };
}

// ── link url (krl) — external URL for kind=link ──────────────────────────────

export type SetResourceLinkInput = {
  spaceId: string;
  nodeId: string;
  url: string;
  host?: string | null;
};

/**
 * Set/update a link node's external URL (UPSERT by node_id). RLS write =
 * `space.knowledge.update`. The URL is an ATTRIBUTE of the node, never a graph
 * edge (ADR-0013 boundary).
 */
export async function setResourceLink(
  input: SetResourceLinkInput,
  deps: KbAttributeDeps
): Promise<ResourceLink> {
  const { db, userId } = deps;
  const { data, error } = await kbSchema(db)
    .from('resource_link')
    .upsert(
      {
        node_id: input.nodeId,
        space_id: input.spaceId,
        url: input.url,
        host: input.host ?? null,
        created_by: userId,
      },
      { onConflict: ON_NODE_ID }
    )
    .select('node_id,url,host')
    .single();
  if (error || !data) {
    throw new Error(`setResourceLink: ${error?.message ?? 'no row'}`);
  }
  return { node_id: data.node_id, url: data.url, host: data.host };
}

// ── media meta (krm) — file size / video duration / mime ─────────────────────
// Metadata ONLY in this slice. Real binary upload + Supabase Storage is deferred
// (poc-no-fallbacks: no fake asset). The shape is ready for that later slice.

export type SetResourceMediaMetaInput = {
  spaceId: string;
  nodeId: string;
  byteSize?: number | null;
  durationMs?: number | null;
  mimeType?: string | null;
};

/**
 * Set/update a file/video node's media metadata (UPSERT by node_id). RLS write =
 * `space.knowledge.update`.
 */
export async function setResourceMediaMeta(
  input: SetResourceMediaMetaInput,
  deps: KbAttributeDeps
): Promise<ResourceMediaMeta> {
  const { db, userId } = deps;
  const { data, error } = await kbSchema(db)
    .from('resource_media_meta')
    .upsert(
      {
        node_id: input.nodeId,
        space_id: input.spaceId,
        byte_size: input.byteSize ?? null,
        duration_ms: input.durationMs ?? null,
        mime_type: input.mimeType ?? null,
        created_by: userId,
      },
      { onConflict: ON_NODE_ID }
    )
    .select('node_id,byte_size,duration_ms,mime_type')
    .single();
  if (error || !data) {
    throw new Error(`setResourceMediaMeta: ${error?.message ?? 'no row'}`);
  }
  return {
    node_id: data.node_id,
    byte_size: data.byte_size,
    duration_ms: data.duration_ms,
    mime_type: data.mime_type,
  };
}

// ── activity (kra) — view-count increment (server counter, REAL) ─────────────
// A node a user can READ may have its counter bumped (the activity RLS mirrors
// node READ, not update). This is a REAL increment under the user's RLS — never a
// fake number, never service-role. Per-open dedup/rate is a presentation concern.

export type IncrementResourceViewCountInput = {
  spaceId: string;
  nodeId: string;
};

/**
 * Increment a node's view counter by one under the user's RLS. The counter row is
 * created on first view (view_count starts at 1) and incremented thereafter. Two
 * round-trips (read-then-write) rather than a DB function: the engine/SQL surface
 * is frozen for this slice and a counter does not warrant a new RPC; the small
 * race (two concurrent opens) at worst under-counts by one, acceptable for a POC
 * view counter (true atomicity is a future RPC if analytics demand it).
 */
export async function incrementResourceViewCount(
  input: IncrementResourceViewCountInput,
  deps: KbAttributeDeps
): Promise<ResourceActivity> {
  const { db } = deps;
  const kb = kbSchema(db);

  const { data: existing, error: readErr } = await kb
    .from('resource_activity')
    .select('view_count')
    .eq('node_id', input.nodeId)
    .maybeSingle();
  if (readErr) {
    throw new Error(`incrementResourceViewCount read: ${readErr.message}`);
  }

  const nextCount = (existing?.view_count ?? 0) + 1;
  const { data, error } = await kb
    .from('resource_activity')
    .upsert(
      {
        node_id: input.nodeId,
        space_id: input.spaceId,
        view_count: nextCount,
      },
      { onConflict: ON_NODE_ID }
    )
    .select('node_id,view_count')
    .single();
  if (error || !data) {
    // RLS rejection (node not readable) → clean failure, no count.
    throw new Error(
      `incrementResourceViewCount: ${error?.message ?? 'no row'}`
    );
  }
  return { node_id: data.node_id, view_count: data.view_count };
}

// NOTE: embed-status (kre) is deliberately NOT written here. It is a RAG seam:
// there is no vector pipeline (pgvector is not in the image), so flipping a status
// to "indexed" would be a lie. poc-no-fallbacks — the status is read-only until the
// vector seam lands.
