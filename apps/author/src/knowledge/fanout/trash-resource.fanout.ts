import type { Database } from '@workspace/db';
import type {
  PurgeResourceInput,
  RestoreResourceInput,
  TrashResourceInput,
} from '@workspace/knowledge-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Payload } from 'payload';

import { deleteBody } from './text-resource.fanout';

/**
 * Trash lifecycle fan-out — UI-agnostic application modules (ADR-0005 §b, ADR-0018).
 *
 * The reversible holding state between "live" and "destroyed":
 *   - trashResource   — soft-delete (UPDATE deleted_at = now()); the DB soft-cascade
 *                       trigger stamps the same timestamp on containment orphans, a
 *                       multi-parent child with a living parent survives. References
 *                       (edges, body) are PRESERVED, just dormant — restore returns them.
 *   - restoreResource — clear deleted_at; re-adoption is automatic (dormant edges are
 *                       the location pointer); the edge visibility policy re-admits
 *                       every reference with zero rebuild.
 *   - purgeResource   — a REAL DELETE (one-way door), reached only from the Trash lens.
 *                       The landed hard orphan-cascade destroys orphaned descendants;
 *                       a durable space_admin_audit_log tombstone outlives the row. For
 *                       a kind=text node the Payload body is best-effort reaped AFTER
 *                       the node DELETE commits (idempotent; Mongo-down leaves an
 *                       unreachable orphan, never a half-write — §13.2).
 *
 * RLS is the SOLE authority on every path:
 *   - trash/restore are gated by the BEFORE-UPDATE authority guard
 *     (assert_trash_change_authorized: owner-sovereign OR space.knowledge.delete);
 *   - purge is gated by the landed delete policy + the in-use guard
 *     (assert_purge_not_in_use). A caller without authority changes/destroys nothing.
 *
 * Every Postgres write runs under the user's RLS-scoped `db` — never service-role.
 */

export type TrashResourceDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
};

export type PurgeResourceDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Payload Local API — for the best-effort body reap (kind=text only). */
  payload: Payload;
};

/**
 * Soft-delete a resource. The single UPDATE stamps `deleted_at`; the DB
 * AFTER-UPDATE soft-cascade trigger follows the containment forest, trashing
 * orphans with the SAME timestamp. The authority guard gates the UPDATE.
 */
export async function trashResource(
  input: TrashResourceInput,
  deps: TrashResourceDeps
): Promise<{ trashed: string[] }> {
  const { db } = deps;
  // RLS resolves the actor; trashed_by is set to the caller via a DB-side
  // default? No — set it explicitly to the session user. The guard reads it
  // only via owner/verb; the column records the current trasher.
  const { data: auth } = await db.auth.getUser();
  const userId = auth.user?.id ?? null;

  const { data, error } = await db
    .from('knowledge_resources')
    .update({
      deleted_at: new Date().toISOString(),
      trashed_by: userId,
    })
    .eq('space_id', input.spaceId)
    .eq('id', input.resourceId)
    .is('deleted_at', null) // idempotent: only a LIVE row transitions to trashed
    .select('id');
  if (error) {
    throw new Error(`trashResource: ${error.message}`);
  }
  // The cascaded orphans are stamped server-side; this RETURNING reports the
  // selected node (the lens refetch surfaces the full trashed set).
  return { trashed: (data ?? []).map((row) => (row as { id: string }).id) };
}

/**
 * Restore a trashed resource. Clears `deleted_at`/`trashed_by`; re-adoption into
 * its original location is automatic (the dormant `contains` edge is the pointer).
 * The trashed-as-a-unit subtree (same deleted_at + trashed_by stamp) is restored
 * together. A descendant trashed in a SEPARATE prior action stays trashed.
 */
export async function restoreResource(
  input: RestoreResourceInput,
  deps: TrashResourceDeps
): Promise<{ restored: string[] }> {
  const { db } = deps;

  // 1. Read the selected node's trash stamp (under RLS) so we can restore exactly
  //    the subtree trashed with it — equal (deleted_at, trashed_by). A row the
  //    caller cannot see returns nothing → a clean no-op.
  const { data: root, error: rootErr } = await db
    .from('knowledge_resources')
    .select('id,deleted_at,trashed_by,space_id')
    .eq('space_id', input.spaceId)
    .eq('id', input.resourceId)
    .not('deleted_at', 'is', null)
    .maybeSingle();
  if (rootErr) {
    throw new Error(`restoreResource read: ${rootErr.message}`);
  }
  if (!root) {
    return { restored: [] };
  }
  const stamp = root as {
    id: string;
    deleted_at: string;
    trashed_by: string | null;
    space_id: string;
  };

  // 2. Collect the trashed-as-a-unit subtree: descendants reachable via `contains`
  //    from the root that carry the SAME deleted_at (the cascade stamped them
  //    atomically). Walk the dormant contains edges client-side under RLS — the
  //    edges are dormant rows, still selectable by the actor (the edge policy hides
  //    them from the CANVAS, but a direct select of edges whose endpoints are the
  //    actor's own trashed nodes returns them via the access helper's is_owner
  //    branch). We bound the walk by the trashed set itself.
  let unitQuery = db
    .from('knowledge_resources')
    .select('id')
    .eq('space_id', input.spaceId)
    .eq('deleted_at', stamp.deleted_at);
  // Match the actor too (the cascade stamps trashed_by atomically): two
  // independent trashes cannot share the exact microsecond timestamp, but pinning
  // trashed_by makes the unit detection exact per ADR-0018 §6.
  unitQuery = stamp.trashed_by
    ? unitQuery.eq('trashed_by', stamp.trashed_by)
    : unitQuery.is('trashed_by', null);
  const { data: trashedRows, error: trashedErr } = await unitQuery;
  if (trashedErr) {
    throw new Error(`restoreResource subtree: ${trashedErr.message}`);
  }
  const unitIds = new Set(
    (trashedRows ?? []).map((r) => (r as { id: string }).id)
  );
  // Always include the explicitly-restored root.
  unitIds.add(stamp.id);

  // 3. Clear the stamp on the unit. The authority guard gates each row's UPDATE;
  //    the activity spine emits kind='restored' per row (actor-stamped). Edges
  //    re-admit automatically once both endpoints are live again (zero rebuild).
  const { data: restored, error: clearErr } = await db
    .from('knowledge_resources')
    .update({ deleted_at: null, trashed_by: null })
    .eq('space_id', input.spaceId)
    .in('id', [...unitIds])
    .not('deleted_at', 'is', null)
    .select('id');
  if (clearErr) {
    throw new Error(`restoreResource: ${clearErr.message}`);
  }
  return {
    restored: (restored ?? []).map((row) => (row as { id: string }).id),
  };
}

/**
 * Permanently destroy a trashed resource (the one-way door). A real DELETE under
 * the user's RLS: the landed delete policy + the in-use guard authorize it, the
 * landed hard orphan-cascade destroys orphaned descendants, and a BEFORE-DELETE
 * trigger writes the durable purge audit tombstone. For a kind=text node the
 * Payload body is reaped best-effort AFTER the node DELETE commits.
 */
export async function purgeResource(
  input: PurgeResourceInput,
  deps: PurgeResourceDeps
): Promise<{ purged: string[] }> {
  const { db, payload } = deps;

  // 1. Read the body_ref (under RLS) BEFORE the delete so we can reap the body
  //    after the node row is gone. A node the caller cannot see returns nothing.
  const { data: node, error: readErr } = await db
    .from('knowledge_resources')
    .select('id,kind,body_ref')
    .eq('space_id', input.spaceId)
    .eq('id', input.resourceId)
    .maybeSingle();
  if (readErr) {
    throw new Error(`purgeResource read: ${readErr.message}`);
  }
  const bodyDocId = extractBodyDocId(
    (node as { body_ref?: unknown } | null)?.body_ref
  );

  // 2. The real DELETE (the authority + in-use + audit + orphan-cascade triggers
  //    all fire here, under the caller's RLS). A caller without authority deletes
  //    nothing — a clean no-op.
  const { data, error } = await db
    .from('knowledge_resources')
    .delete()
    .eq('space_id', input.spaceId)
    .eq('id', input.resourceId)
    .select('id');
  if (error) {
    throw new Error(`purgeResource: ${error.message}`);
  }
  const purged = (data ?? []).map((row) => (row as { id: string }).id);

  // 3. Best-effort body reap AFTER the node DELETE commits (§13.2). One-directional:
  //    the authority (node) is gone decisively; the satellite reap can only fail
  //    OPEN (orphan), never destructive. Only when the node was actually purged.
  if (purged.length > 0 && bodyDocId) {
    await deleteBody(payload, bodyDocId);
  }

  return { purged };
}

/** Pull the Payload `bodies` doc id out of a `body_ref` jsonb, if present. */
function extractBodyDocId(bodyRef: unknown): string | null {
  if (
    bodyRef &&
    typeof bodyRef === 'object' &&
    'doc_id' in bodyRef &&
    typeof (bodyRef as { doc_id: unknown }).doc_id === 'string'
  ) {
    return (bodyRef as { doc_id: string }).doc_id;
  }
  return null;
}
