import { entityIds } from '@workspace/entity-id';
import { z } from 'zod';

/**
 * Domain input contract for moving a knowledge resource in the containment hierarchy.
 *
 * A canonical knowledge resource move is one atomic operation (`move_node`),
 * rather than independent `remove_edge` and `upsert_edge` steps.
 *
 * Invariants:
 *  - `targetParentId`: nullable; null indicates placement at the space top level.
 *  - `position`: nonnegative integer (zero or positive).
 *  - `nodeId !== targetParentId`: a node cannot be its own parent.
 *  - Entity IDs validate against standard space and knowledgeResource prefix schemas.
 *  - Server is the authority; actor identity is derived from the authenticated session,
 *    never passed in the payload.
 */
export const moveKnowledgeResourceInputSchema = z
  .object({
    spaceId: entityIds.space.prefixSchema,
    nodeId: entityIds.knowledgeResource.prefixSchema,
    targetParentId: entityIds.knowledgeResource.prefixSchema.nullable(),
    position: z.number().int().nonnegative(),
  })
  .refine(
    (data) =>
      data.targetParentId === null || data.nodeId !== data.targetParentId,
    {
      message: 'nodeId cannot be its own targetParentId',
      path: ['targetParentId'],
    }
  );

export type MoveKnowledgeResourceInput = z.infer<
  typeof moveKnowledgeResourceInputSchema
>;

export function parseMoveKnowledgeResourceInput(raw: unknown) {
  return moveKnowledgeResourceInputSchema.safeParse(raw);
}
