import { z } from 'zod';

/**
 * NeighborhoodSpec / NeighborhoodResult — the contract of the SECOND read port
 * over the knowledge graph (docs/knowledge-graph-plan.md): a bounded-BFS walk
 * around a SINGLE center node, orthogonal to projection resolution.
 *
 * Where `resolveProjection` walks from a filter-derived START SET and
 * materializes an ordered list under a `view`, neighborhood walks from ONE given
 * center node (passed as a resolve arg, not in the spec), bounded to depth ≤ 2,
 * and returns a flat, RLS-narrowed `neighbors[]` carrying `relation_type`,
 * `direction` and `depth` — leaving the grouping (which relation_type means
 * "related" vs "tag", how depth folds into a tree) entirely to the presentation
 * layer. The engine stays mechanism-neutral and taxonomy-agnostic.
 *
 * NeighborhoodSpec is NOT an access condition: RLS is the only authority that
 * narrows what a user may see; this spec only chooses which relation_types /
 * direction to walk and how deep. The center node id + space scope are resolve
 * args, mirroring resolveProjection(spaceId, projectionId) separation.
 */

export const NEIGHBORHOOD_SPEC_SCHEMA_VERSION = 1 as const;

export const neighborhoodDirectionSchema = z.enum([
  'outgoing', // edges from the center (e.g. resource → tag for `tagged`)
  'incoming', // edges into the center (e.g. resource → tag, read from a tag node)
  'both',
]);
export type NeighborhoodDirection = z.infer<typeof neighborhoodDirectionSchema>;

export const neighborhoodSpecSchema = z.object({
  schema_version: z.literal(NEIGHBORHOOD_SPEC_SCHEMA_VERSION),
  // which relation_type keys to follow. min(1): an empty walk is degenerate.
  relation_types: z.array(z.string()).min(1),
  direction: neighborhoodDirectionSchema.default('outgoing'),
  // bounded BFS depth from the center. 1 = one hop (first paint / resource panel),
  // 2 = the lazy-expand cap. Hard-capped at 2: deeper is reached by re-centering
  // on another node, never by raising this (anti-DoS, predictable latency).
  max_depth: z.number().int().min(1).max(2).default(1),
  // hard cap on neighbors returned per relation group PER LEVEL (anti-DoS on hubs).
  limit_per_relation: z.number().int().min(1).max(200).default(50),
});
export type NeighborhoodSpec = z.infer<typeof neighborhoodSpecSchema>;

// one neighbor + the edge it was reached through + the direction + BFS depth.
export const neighborSchema = z.object({
  edge_id: z.string(), // kne_…
  relation_type: z.string(), // echo — the view groups by this (data, not taxonomy)
  direction: z.enum(['outgoing', 'incoming']), // relative to the path it sat on
  depth: z.number().int().min(1), // BFS level from the center (1..max_depth)
  node: z.object({
    id: z.string(), // knr_…
    kind: z.string(),
    title: z.string(),
    status: z.string(),
    visibility: z.string(),
    // {collection, doc_id} | null — Payload body bridge indicator (ADR-0002)
    body_ref: z.unknown().nullable(),
  }),
  position: z.number().int(), // edge.position (ordering within a relation group)
});
export type Neighbor = z.infer<typeof neighborSchema>;

export const neighborhoodResultSchema = z.object({
  center_id: z.string(), // the queried center node (knr_…)
  // neighbors flat, already RLS-narrowed + ordered (depth, relation_type, position).
  // The VIEW groups by relation_type/direction AND nests by depth — the engine
  // does not pre-bucket by application meaning (related/tags), keeping it
  // taxonomy-agnostic. Cycle-guard: a node already on the path is not re-emitted.
  neighbors: z.array(neighborSchema),
});
export type NeighborhoodResult = z.infer<typeof neighborhoodResultSchema>;

export function parseNeighborhoodSpec(raw: unknown) {
  return neighborhoodSpecSchema.safeParse(raw);
}
