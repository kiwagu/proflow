import { createEntityId } from '@workspace/entity-id';
import type { Database } from '@workspace/db';
import type { BodyRef } from '@workspace/knowledge-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Payload } from 'payload';

/**
 * Deep-copy a resource and its `contains` SUBTREE — UI-agnostic application
 * module (ADR-0005 §b). "Copy this folder" duplicates the whole tree: the node,
 * every `contains` descendant, and each text node's Lexical body. Shortcuts
 * (Drive symlinks), tags, and the per-user state (starred / opened) are NOT
 * carried — a copy is fresh content, not an alias.
 *
 * FAIL-CLOSED by construction (ADR-0017): every clone is born the way any new
 * node is — `created_by`/`owner` pinned to the COPIER and `visibility` left at the
 * private default. So a copy of someone-else's shared tree lands as the copier's
 * OWN private drafts, never re-broadcasting the source's audience. The traversal
 * runs under the copier's RLS, so it duplicates ONLY what the copier may read — a
 * hidden sub-node is silently skipped (no leak, nothing to copy).
 *
 * Cross-store, like the text create: nodes + edges live in Postgres (under RLS),
 * bodies in Payload (`bodies`, overrideAccess — the node was already RLS-gated).
 * Best-effort ALL-OR-NOTHING: a failure mid-copy compensates by deleting every
 * node (FK cascades its edges) and body created so far, so a broken copy leaves no
 * orphans (no reconciler exists to heal a half-write — poc-no-fallbacks).
 */

type Db = SupabaseClient<Database>;

type SourceNode = Pick<
  Database['public']['Tables']['knowledge_resources']['Row'],
  'id' | 'kind' | 'title'
>;

export type CopyResourceSubtreeInput = {
  spaceId: string;
  /** The node to copy (root of the `contains` subtree). */
  sourceId: string;
  /** Where the root copy lands — a folder id, or null for the top level. */
  targetFolderId: string | null;
  /**
   * Title for the ROOT copy (the caller builds the i18n "X (copy)" label so the
   * suffix stays in the front). Descendants keep their own titles. Omitted → the
   * source title verbatim.
   */
  rootTitle?: string;
};

export type CopyResourceSubtreeDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: Db;
  /** Authenticated Supabase user id (the copier — `created_by`/`owner`). */
  userId: string;
  /** Payload Local API instance (the `bodies` clone). */
  payload: Payload;
};

export type CopyResourceSubtreeResult = {
  /** The new root copy id. */
  node_id: string;
  /** Total nodes copied (root + readable descendants). */
  count: number;
};

/** Read a node under the copier's RLS — null when it is not readable (skip it). */
async function readNode(
  db: Db,
  spaceId: string,
  id: string
): Promise<SourceNode | null> {
  const { data } = await db
    .from('knowledge_resources')
    .select('id,kind,title')
    .eq('id', id)
    .eq('space_id', spaceId)
    .maybeSingle();
  return data;
}

/** Best-effort compensation: drop the node (FK cascades its edges). */
async function deleteNode(
  db: Db,
  spaceId: string,
  nodeId: string
): Promise<void> {
  await db
    .from('knowledge_resources')
    .delete()
    .eq('id', nodeId)
    .eq('space_id', spaceId);
}

/** Best-effort compensation: drop an orphaned Payload body. */
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

/**
 * Clone a text node's Lexical body to the new node, bridged by `body_ref`.
 * Returns the new body doc id (for compensation), or null when the source has no
 * body yet (a legacy bodyless `kind=text` — the copy stays bodyless and self-heals
 * on open via `ensureNodeBody`).
 */
async function cloneBody(
  db: Db,
  payload: Payload,
  spaceId: string,
  sourceId: string,
  newId: string
): Promise<string | null> {
  const found = await payload.find({
    collection: 'bodies',
    where: { node_id: { equals: sourceId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
    pagination: false,
  });
  const src = found.docs[0] as { body?: unknown } | undefined;
  if (!src?.body) {
    return null;
  }

  const doc = await payload.create({
    collection: 'bodies',
    overrideAccess: true,
    data: {
      id: createEntityId('bod'),
      node_id: newId,
      space_id: spaceId,
      body: src.body as never,
    },
  });
  const docId = String(doc.id);

  const bodyRef: BodyRef = { collection: 'bodies', doc_id: docId };
  const { error } = await db
    .from('knowledge_resources')
    .update({ body_ref: bodyRef })
    .eq('id', newId)
    .eq('space_id', spaceId);
  if (error) {
    await deleteBody(payload, docId);
    throw new Error(`copyResourceSubtree body_ref: ${error.message}`);
  }
  return docId;
}

export async function copyResourceSubtree(
  input: CopyResourceSubtreeInput,
  deps: CopyResourceSubtreeDeps
): Promise<CopyResourceSubtreeResult> {
  const { db, userId, payload } = deps;
  const { spaceId, sourceId, targetFolderId, rootTitle } = input;

  // 1. Walk the source `contains` subtree under the copier's RLS. Each node is
  //    visited once (shared/multi-parent children copy once, both edges preserved);
  //    an unreadable child is skipped (and its edge dropped) — copy only what you
  //    can see.
  const nodes = new Map<string, SourceNode>();
  const edges: Array<{ from: string; to: string; position: number }> = [];

  const root = await readNode(db, spaceId, sourceId);
  if (!root) {
    throw new Error('copyResourceSubtree: source not found or not readable');
  }
  nodes.set(sourceId, root);

  const queue: string[] = [sourceId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const { data: childEdges } = await db
      .from('knowledge_edges')
      .select('to_id,position')
      .eq('space_id', spaceId)
      .eq('from_id', current)
      .eq('relation_type', 'contains');
    for (const edge of childEdges ?? []) {
      const childId = edge.to_id;
      if (!nodes.has(childId)) {
        const childRow = await readNode(db, spaceId, childId);
        if (!childRow) {
          continue; // unreadable under RLS → not copyable, drop the edge too
        }
        nodes.set(childId, childRow);
        queue.push(childId);
      }
      edges.push({ from: current, to: childId, position: edge.position ?? 0 });
    }
  }

  // 2..4. Create the clones (compensating every created node + body on any failure).
  const oldToNew = new Map<string, string>();
  const createdNodeIds: string[] = [];
  const createdBodyDocIds: string[] = [];
  try {
    // 2. Clone each node — `created_by`/`owner` = copier, `visibility` defaults
    //    private (fail-closed). Root takes the caller's "(copy)" title.
    for (const [oldId, src] of nodes) {
      const title = oldId === sourceId ? (rootTitle ?? src.title) : src.title;
      const { data: node, error } = await db
        .from('knowledge_resources')
        .insert({
          space_id: spaceId,
          kind: src.kind,
          title,
          status: 'active',
          created_by: userId,
          owner_user_id: userId,
        })
        .select('id')
        .single();
      if (error || !node?.id) {
        throw new Error(
          `copyResourceSubtree node: ${error?.message ?? 'no id'}`
        );
      }
      createdNodeIds.push(node.id);
      oldToNew.set(oldId, node.id);

      if (src.kind === 'text') {
        const bodyDocId = await cloneBody(db, payload, spaceId, oldId, node.id);
        if (bodyDocId) {
          createdBodyDocIds.push(bodyDocId);
        }
      }
    }

    // 3. Recreate the `contains` edges inside the subtree (mapped old → new).
    for (const edge of edges) {
      const from = oldToNew.get(edge.from);
      const to = oldToNew.get(edge.to);
      if (!from || !to) {
        continue;
      }
      const { error } = await db.from('knowledge_edges').insert({
        space_id: spaceId,
        from_id: from,
        to_id: to,
        relation_type: 'contains',
        position: edge.position,
        created_by: userId,
      });
      if (error) {
        throw new Error(`copyResourceSubtree contains: ${error.message}`);
      }
    }

    // 4. Place the root copy inside the target folder (top level → no parent edge).
    const newRoot = oldToNew.get(sourceId) as string;
    if (targetFolderId) {
      const { error } = await db.from('knowledge_edges').insert({
        space_id: spaceId,
        from_id: targetFolderId,
        to_id: newRoot,
        relation_type: 'contains',
        position: 0,
        created_by: userId,
      });
      if (error) {
        throw new Error(`copyResourceSubtree placement: ${error.message}`);
      }
    }

    return { node_id: newRoot, count: createdNodeIds.length };
  } catch (error) {
    for (const docId of createdBodyDocIds) {
      await deleteBody(payload, docId);
    }
    for (const nodeId of createdNodeIds.reverse()) {
      await deleteNode(db, spaceId, nodeId);
    }
    throw error;
  }
}
