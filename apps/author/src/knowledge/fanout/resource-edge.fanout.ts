import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createBodylessResource } from './bodyless-resource.fanout';

/**
 * Edge authoring — UI-agnostic application module (ADR-0005 §b). Relationships
 * between nodes are `knowledge_edges` rows (Invariant #1), never a side table.
 *
 * Authorable relations (the write scope of the consumer surface):
 *   - `relates_to` (associative link), `tagged` (resource→tag),
 *   - `contains`   (folder→child, FORWARD — place / move into a folder, ADR-0015),
 *   - `shortcut`   (folder→target, Drive cross-folder symlink, ADR-0015).
 * `contains`/`shortcut` direction is ALWAYS folder→child/target (from_id=folder);
 * the caller passes the folder as `fromId`. `part_of`/`prerequisite` stay
 * structural and out of this write scope.
 *
 * EVERY write runs under the user's RLS-scoped `db` — never service-role. RLS is
 * the SOLE authority: create gates on `space.knowledge.create`, delete on
 * `space.knowledge.delete`, both on the edge row itself. `created_by` comes from
 * the session.
 */

export const AUTHORABLE_RELATION_TYPES = [
  'relates_to',
  'tagged',
  'contains',
  'shortcut',
] as const;
export type AuthorableRelationType = (typeof AUTHORABLE_RELATION_TYPES)[number];

export type CreateEdgeInput = {
  spaceId: string;
  fromId: string;
  toId: string;
  relationType: AuthorableRelationType;
  position?: number;
};

/**
 * Create an authorable edge under the user's RLS. Idempotent against the
 * `(from_id,to_id,relation_type)` unique index: a duplicate is treated as success
 * (the edge already exists) — a double-tag / double-link / re-place is a no-op
 * rather than a hard error.
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
  | { fromId: string; toId: string; relationType: AuthorableRelationType }
);

/**
 * Delete an edge (unlink / untag / un-place) under the user's RLS
 * (`space.knowledge.delete`). Either by edge id, or by the
 * `(from_id,to_id,relation_type)` triple the UI already holds. Returns how many
 * rows the user's RLS context actually deleted (0 = nothing visible/permitted — a
 * clean no-op, not an error).
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

export type TagResourceInput = {
  spaceId: string;
  resourceId: string; // knr_… resource being tagged (edge from_id)
  // Either an existing tag node id, or a new tag title to create first.
  tagId?: string;
  tagTitle?: string;
};

/**
 * Tag a resource (`tagged` edge from_id=resource → to_id=tag) under the user's RLS.
 * Two-step: if no `tagId` is given, first create the `kind='tag'` node (body-less),
 * then the `tagged` edge — both under RLS, both verb-gated on the row. Idempotent
 * at the edge step. Order: node before edge so a partial failure leaves a
 * reconcilable tag node (orphan tag is harmless; the edge is the meaning).
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
