import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import { kbSchema } from '@/lib/supabase/kb-schema';

/**
 * KB application-attribute write module — UI-agnostic (ADR-0005 §b / ADR-0011 §4).
 * Each KB attribute is a per-node SATELLITE in the dedicated `kb` schema (ADR-0013):
 * a 1:1 row keyed by `node_id`. These functions are the write seam; the route is a
 * thin transport and the view holds none of this logic. EVERY write runs under the
 * user's RLS-scoped `db`; RLS mirrors the parent node's access (write =
 * `space.knowledge.update`). Grows one satellite at a time as its feature lands.
 */

export type KbAttributeDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (created_by attribution). */
  userId: string;
};

const ON_NODE_ID = 'node_id' as const;

export type SetResourceDescriptionInput = {
  spaceId: string;
  nodeId: string;
  body: string;
};

/**
 * Set/update a node's description (UPSERT by node_id) under the user's RLS
 * (`space.knowledge.update`). The text is the field a future RAG vector seam will
 * embed; the text is stored now, the vector is not (poc-no-fallbacks).
 */
export async function setResourceDescription(
  input: SetResourceDescriptionInput,
  deps: KbAttributeDeps
): Promise<{ node_id: string; body: string }> {
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
