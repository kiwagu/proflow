import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Body-less resource authoring — UI-agnostic application module (ADR-0005 §b).
 *
 * `link`/`tag`/`folder`/`file`/`video` carry NO Lexical body and NO Payload doc
 * (ADR-0002 §3 / ADR-0015: a folder is a pure container kind; file/video carry
 * their resource via the media-meta satellite, real binary upload deferred). So a
 * create here is a single RLS-scoped INSERT (+ an optional `contains` edge to place
 * the node inside a folder). `text` creation is NOT here — it fans out through
 * Payload on its own route.
 *
 * EVERY write runs under the user's RLS-scoped `db` — never service-role. Postgres
 * RLS is the SOLE write authority: the INSERT's `with check` gates on
 * `space.knowledge.create` and pins `created_by` to the caller (a BEFORE-INSERT
 * trigger then defaults `owner_user_id` to `created_by`). A reader's create fails
 * cleanly with no row. `created_by`/`owner` come from the SESSION, never the body.
 */

/** Containment placement: a FORWARD `contains` edge folder→child (ADR-0015). */
export type ParentFolderPlacement = {
  parentFolderId: string; // knr_… of a kind=folder node in the same space
  position?: number;
};

/** An optional explicit edge created alongside the new node. */
export type FanoutEdgeInput = {
  relationType: 'prerequisite' | 'relates_to';
  toId: string; // existing node in the same space
};

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
  /** Authenticated Supabase user id (created_by attribution). */
  userId: string;
};

export type CreateBodylessResourceResult = {
  node_id: string;
  kind: BodylessKind;
  edge_id?: string;
  contains_edge_id?: string;
};

type InsertEdgeInput = {
  spaceId: string;
  fromId: string;
  toId: string;
  relationType: string;
  position?: number;
};

/** One RLS-scoped edge INSERT (`created_by` from the session). */
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

/**
 * Create a body-less node (`link`/`tag`/`folder`/`file`/`video`), optionally placed
 * inside a folder via a `contains` edge. One authoritative INSERT under the user's
 * RLS; a clean failure (RLS rejection ⇒ no row) when the caller lacks
 * `space.knowledge.create`.
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

export type RenameResourceInput = {
  spaceId: string;
  resourceId: string; // knr_…
  title: string;
};

/**
 * Rename a node's title under the user's RLS (`space.knowledge.update` enforced by
 * RLS on the UPDATE, never an application check). `space_id` scopes the row; the
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
    throw new Error(`renameResource: ${error?.message ?? 'not found'}`);
  }
  return { node_id: data.id, title: data.title };
}
