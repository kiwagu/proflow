import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Delete a knowledge resource — UI-agnostic application module (ADR-0005 §b).
 *
 * Just deletes the SELECTED node under the user's RLS. The containment-orphan
 * cascade (delete children that lose their last containment parent; many-to-one
 * children survive) is enforced in the DATABASE by a BEFORE-DELETE trigger
 * (`kb_cascade_delete_containment_orphans`), so the rule holds for every caller —
 * this route today and a future REST/MCP API hitting the table directly, not just
 * the app layer. Edges + cohort scope-links of any deleted node are removed by FK
 * `on delete cascade`.
 *
 * RLS is the SOLE authority: the DELETE is gated on `space.knowledge.delete` per
 * row (the trigger's cascaded deletes run as the same user, same gate). A caller
 * without the verb deletes nothing — a clean no-op.
 */

export type DeleteResourceInput = {
  spaceId: string;
  resourceId: string; // knr_… the selected node
};

export async function deleteResourceCascade(
  input: DeleteResourceInput,
  deps: { db: SupabaseClient<Database> }
): Promise<{ deleted: string[] }> {
  const { db } = deps;
  // The DB trigger cascades to orphaned descendants; this RETURNING reports the
  // selected node (cascaded rows are removed server-side, surfaced by a refetch).
  const { data, error } = await db
    .from('knowledge_resources')
    .delete()
    .eq('space_id', input.spaceId)
    .eq('id', input.resourceId)
    .select('id');
  if (error) {
    throw new Error(`deleteResourceCascade: ${error.message}`);
  }
  return { deleted: (data ?? []).map((row) => (row as { id: string }).id) };
}
