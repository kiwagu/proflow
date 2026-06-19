import { z } from 'zod';

/**
 * KB node satellite `kb.resource_embedding` (see docs/knowledge-graph-plan.md).
 * The embed STATUS only — there is NO vector here (pgvector is not in the
 * self-hosted image; poc-no-fallbacks forbids faking semantic search). The status
 * lets the UI show indexed/stale/indexing without a vector; the vector column is a
 * future seam that lands with zero rework.
 *
 * `embedStatusSchema` is the single source of truth shared by the DB CHECK and any
 * status-write path; keep it in lock-step with the migration.
 */
export const embedStatusSchema = z.enum(['indexed', 'stale', 'indexing']);
export type EmbedStatus = z.infer<typeof embedStatusSchema>;

export const resourceEmbeddingSchema = z.object({
  node_id: z.string(), // knr_…
  status: embedStatusSchema,
});
export type ResourceEmbedding = z.infer<typeof resourceEmbeddingSchema>;

export function parseResourceEmbedding(raw: unknown) {
  return resourceEmbeddingSchema.safeParse(raw);
}
