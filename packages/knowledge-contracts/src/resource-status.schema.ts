import { entityIds } from '@workspace/entity-id';
import { z } from 'zod';

/**
 * Resource-status (workflow lifecycle) input contract. `knowledge_resources.status`
 * is a coarse three-state lifecycle — `draft` → `active` → `archived` — held as a
 * plain CHECK-constrained column (migration 20260615190243). The richer
 * workflow-as-data machine (`resource_workflows.definition`, ADR-0007) is a FUTURE
 * per-space overlay; until it lands the lifecycle is this flat enum, so the panel's
 * transition control writes a direct status set (mirrors the visibility floor set).
 *
 * Status (workflow) is ORTHOGONAL to `visibility` (access floor) and to `deleted_at`
 * (trash) — this contract never reads or writes either. It carries ONLY the scope +
 * target + the new status; authority (`space.knowledge.update`) is enforced by
 * Postgres RLS on the UPDATE, never by this schema (zod-schema-first-contracts:
 * shape at the boundary, fence in the DB).
 */

/** The three lifecycle states, mirrored from the DB CHECK (single source of truth). */
export const resourceStatusSchema = z.enum(['draft', 'active', 'archived']);
export type ResourceStatus = z.infer<typeof resourceStatusSchema>;

/** Set a node's workflow status under the caller's RLS. */
export const setResourceStatusInputSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  resourceId: entityIds.knowledgeResource.prefixSchema, // knr_… the selected node
  status: resourceStatusSchema,
});
export type SetResourceStatusInput = z.infer<
  typeof setResourceStatusInputSchema
>;

export function parseSetResourceStatusInput(raw: unknown) {
  return setResourceStatusInputSchema.safeParse(raw);
}
