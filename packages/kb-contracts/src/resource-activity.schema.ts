import { z } from 'zod';

/**
 * KB node satellite `kb.resource_activity` (see docs/knowledge-graph-plan.md).
 * A real per-node view counter (incremented server-side under the user's RLS on
 * open). `view_count` is a non-negative integer; it is `bigint` in the DB, so it
 * is modeled as a JS number here (POC counts fit comfortably).
 */
export const resourceActivitySchema = z.object({
  node_id: z.string(), // knr_…
  view_count: z.number().int().min(0),
});
export type ResourceActivity = z.infer<typeof resourceActivitySchema>;

export function parseResourceActivity(raw: unknown) {
  return resourceActivitySchema.safeParse(raw);
}
