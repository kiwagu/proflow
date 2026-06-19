import { z } from 'zod';

/**
 * KB node satellite `kb.resource_provenance` (see docs/knowledge-graph-plan.md).
 * `source` is a small CLOSED set (mirror of the DB CHECK), not a vocabulary —
 * provenance is not an app-extensibility axis, so it is a fixed enum kept in
 * lock-step with the migration's CHECK constraint.
 */
export const provenanceSourceSchema = z.enum(['human', 'imported', 'ai']);
export type ProvenanceSource = z.infer<typeof provenanceSourceSchema>;

export const resourceProvenanceSchema = z.object({
  node_id: z.string(), // knr_…
  source: provenanceSourceSchema,
});
export type ResourceProvenance = z.infer<typeof resourceProvenanceSchema>;

export function parseResourceProvenance(raw: unknown) {
  return resourceProvenanceSchema.safeParse(raw);
}
