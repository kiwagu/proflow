import { z } from 'zod';

/**
 * ProjectionSpec — a business app described as a saved projection over the one
 * knowledge graph (filter + traversal + view). Persisted as jsonb in
 * `public.projections`; validated at the app boundary by this schema.
 *
 * Contract boundary: a ProjectionSpec NEVER carries an access condition. Access
 * is derived from RBAC via Postgres RLS; the projection filter only narrows what
 * RLS already allows. The filter field allow-list below physically cannot express
 * identity/space/permission — keep it that way (see docs/knowledge-graph-plan.md).
 */

export const PROJECTION_SPEC_SCHEMA_VERSION = 1 as const;

// --- FilterNode: a small boolean AST that narrows the RLS-allowed node set. ---

export const filterOperatorSchema = z.enum(['eq', 'neq', 'in', 'contains']);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

/**
 * Allow-list of filterable fields (anti-injection). Every entry is a REAL scalar
 * column on the knowledge node (`kind`, `status`, `visibility`, `title`) — there
 * is no virtual/metadata-backed field. Tagging is NOT a filter field: a tag is a
 * graph node (`kind='tag'`) and "has tag T" is a traversal over `tagged` edges,
 * not a column value (Variant B). Identity/access fields are deliberately absent.
 */
export const filterFieldSchema = z.enum([
  'kind',
  'status',
  'visibility',
  'title',
]);
export type FilterField = z.infer<typeof filterFieldSchema>;

export const filterLeafSchema = z.object({
  field: filterFieldSchema,
  op: filterOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export type FilterLeaf = z.infer<typeof filterLeafSchema>;

// recursive boolean AST
export type FilterNode =
  | FilterLeaf
  | { and: FilterNode[] }
  | { or: FilterNode[] }
  | { not: FilterNode };

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    filterLeafSchema,
    z.object({ and: z.array(filterNodeSchema).min(1) }),
    z.object({ or: z.array(filterNodeSchema).min(1) }),
    z.object({ not: filterNodeSchema }),
  ])
);

// --- TraversalSpec: compiles (in a later slice) to a recursive CTE over edges. ---

export const traversalDirectionSchema = z.enum(['outgoing', 'incoming']);
export type TraversalDirection = z.infer<typeof traversalDirectionSchema>;

export const traversalOrderBySchema = z.enum([
  'position',
  'created_at',
  'title',
]);
export type TraversalOrderBy = z.infer<typeof traversalOrderBySchema>;

export const traversalStartSchema = z.object({
  // start = nodes matching this filter (within the RLS-allowed set)
  filter: filterNodeSchema.optional(),
  // or explicit knr_ ids
  ids: z.array(z.string()).optional(),
});
export type TraversalStart = z.infer<typeof traversalStartSchema>;

export const traversalSpecSchema = z.object({
  start: traversalStartSchema,
  // which relation_type keys to follow; [] = no traversal (flat slice)
  relation_types: z.array(z.string()).min(0),
  direction: traversalDirectionSchema.default('outgoing'),
  // 0 = no traversal (flat set); KB uses 0/1, course follows prerequisites
  max_depth: z.number().int().min(0).max(16).default(0),
  order_by: traversalOrderBySchema.default('position'),
});
export type TraversalSpec = z.infer<typeof traversalSpecSchema>;

// --- ViewType: must match a view_types.key row (string here, FK-checked in DB). ---

export const viewTypeSchema = z.string();
export type ViewType = z.infer<typeof viewTypeSchema>;

// --- Gating declaration: which pluggable gating rule applies to this app. ---

/**
 * The key of a gating rule in the engine's GATING_RULE_REGISTRY (slice-06 §3.4).
 * A neutral mechanism key (`sequence`, `requires_state`), never an application
 * name. Gating is DISPLAY-only: a gated node stays in the result (the node is
 * present, `available=false`); RLS remains the sole hard access authority.
 */
export const gatingRuleKeySchema = z.string();
export type GatingRuleKey = z.infer<typeof gatingRuleKeySchema>;

/**
 * A ProjectionSpec DECLARES its gating rule (which rule + the rule's params). The
 * common contract keeps `params` generic (`record`); each rule zod-parses its own
 * params shape internally (e.g. `requires_state` parses `{ allowed: string[] }`).
 * This mirrors how the filter leaf is strict while `metadata` stays generic.
 */
export const gatingDeclarationSchema = z.object({
  rule: gatingRuleKeySchema, // 'sequence' | 'requires_state' | …
  params: z.record(z.string(), z.unknown()).default({}), // e.g. { allowed: ['approved'] }
});
export type GatingDeclaration = z.infer<typeof gatingDeclarationSchema>;

export const projectionSpecSchema = z.object({
  schema_version: z.literal(PROJECTION_SPEC_SCHEMA_VERSION),
  // projection filter (narrows only — never an access condition)
  filter: filterNodeSchema,
  traversal: traversalSpecSchema,
  view: viewTypeSchema,
  // optional pluggable gating rule (display only — never an access condition).
  // additive + optional: existing specs (KB grid, course) parse unchanged, so the
  // pinned schema_version stays 1 (forward/backward compatible).
  gating: gatingDeclarationSchema.optional(),
});
export type ProjectionSpec = z.infer<typeof projectionSpecSchema>;

export function parseProjectionSpec(raw: unknown) {
  return projectionSpecSchema.safeParse(raw);
}
