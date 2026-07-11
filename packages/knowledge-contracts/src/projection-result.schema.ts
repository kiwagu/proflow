import { entityIds } from '@workspace/entity-id';
import { z } from 'zod';

/**
 * ProjectionResult — the output contract of resolving a ProjectionSpec: an
 * ordered set of knowledge resources the current user may see (under RLS), plus
 * the traversal context a view needs to render (depth + the edge each node was
 * reached through). This is a DOMAIN result contract, not a transport envelope.
 *
 * The internal cycle-guard `path` is deliberately NOT surfaced here; add a
 * `path: z.array(z.string())` to the item later if a view needs the full route.
 * `order_by` is not echoed — order is already materialized into `items`.
 */

// one resolved projection node + its traversal context for the view layer
export const projectionResultItemSchema = z.object({
  id: entityIds.knowledgeResource.prefixSchema, // knr_…
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  visibility: z.string(),
  // {collection, doc_id} | null — Payload body bridge deferred
  body_ref: z.unknown().nullable(),
  // --- traversal context (for course/graph views) ---
  depth: z.number().int().min(0), // distance from the start node
  via_edge_id: entityIds.knowledgeEdge.prefixSchema.nullable(), // edge we arrived through (null for start nodes)
});
export type ProjectionResultItem = z.infer<typeof projectionResultItemSchema>;

export const projectionResultSchema = z.object({
  // NOT prefix-gated: a real projection is `prj_…`, but the default lens uses the
  // `default-lens` sentinel (graph-page.data.ts), so this is not always an entity id.
  projection_id: z.string(),
  view: z.string(), // echo of spec.view — the view layer picks the renderer
  items: z.array(projectionResultItemSchema), // already in order (see traversal order_by)
});
export type ProjectionResult = z.infer<typeof projectionResultSchema>;

export function parseProjectionResult(raw: unknown) {
  return projectionResultSchema.safeParse(raw);
}
