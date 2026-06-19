import { z } from 'zod';

/**
 * KB node satellite `kb.resource_description` (see docs/knowledge-graph-plan.md).
 * The RAG-bound description text carried 1:1 by any node (incl. folder/tag). This
 * is the DOMAIN contract for that attribute, mirroring the DB row shape — NOT a
 * transport envelope and NOT a graph-engine contract (the engine stays frozen).
 *
 * The description text is the field the future RAG vector seam will embed; it is
 * stored now, the vector is not (poc-no-fallbacks — pgvector is not in the image).
 */
export const resourceDescriptionSchema = z.object({
  node_id: z.string(), // knr_…
  body: z.string(),
});
export type ResourceDescription = z.infer<typeof resourceDescriptionSchema>;

export function parseResourceDescription(raw: unknown) {
  return resourceDescriptionSchema.safeParse(raw);
}
