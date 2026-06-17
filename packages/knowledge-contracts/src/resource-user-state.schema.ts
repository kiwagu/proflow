import { z } from 'zod';

/**
 * Per-user state overlay contract (see docs/knowledge-graph-plan.md §2). The thin
 * anchor `resource_user_state` holds the cross-app minimum — a coarse status per
 * (user, resource) — that the gating layer reads uniformly. This is the DOMAIN
 * contract for that overlay, not a transport envelope.
 *
 * `coarseStatusSchema` is the single source of truth shared by the DB CHECK
 * (kept in lock-step with the migration), the progress write-endpoint, and the
 * pure gating function. It is a deliberately small, closed, cross-app set — the
 * stable roll-up target — NOT an app-extensibility vocabulary. App-specific
 * richness lives in fine statuses on a future child satellite; a request to add
 * a value here is a signal it belongs to that fine layer instead.
 */

/** Closed cross-app coarse set (mirror of the DB CHECK). */
export const coarseStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'done',
  'blocked',
]);
export type CoarseStatus = z.infer<typeof coarseStatusSchema>;

/** One per-user state row (anchor). `progress` is optional generic %. */
export const resourceUserStateSchema = z.object({
  resource_id: z.string(), // knr_…
  coarse_status: coarseStatusSchema,
  progress: z.number().int().min(0).max(100).nullable().optional(),
});
export type ResourceUserState = z.infer<typeof resourceUserStateSchema>;

/**
 * Overlay = a map node_id → coarse_status. The minimum the gating function needs
 * (one coarse status per node); the full row shape is reserved for the future.
 */
export const resourceUserStateMapSchema = z.record(
  z.string(),
  coarseStatusSchema
);
export type ResourceUserStateMap = z.infer<typeof resourceUserStateMapSchema>;

export function parseResourceUserStateMap(raw: unknown) {
  return resourceUserStateMapSchema.safeParse(raw);
}
