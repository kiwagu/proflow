import { entityIds } from '@workspace/entity-id';
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
  resource_id: entityIds.knowledgeResource.prefixSchema, // knr_…
  coarse_status: coarseStatusSchema,
  progress: z.number().int().min(0).max(100).nullable().optional(),
  // Per-(user, resource) pin flag. Mirrors the NOT NULL DEFAULT false column:
  // the row always carries it; absent input defaults to unstarred.
  starred: z.boolean().default(false),
  // Per-user "recently opened by me" roll-up: the greatest
  // occurred_at over this user's `kind=open` activity rows for the resource.
  // Null/absent = never opened by this user. Maintained by the DB roll-up
  // trigger; it is read-only state here (the open-route never writes it).
  last_opened_at: z.string().datetime().nullable().optional(),
});
export type ResourceUserState = z.infer<typeof resourceUserStateSchema>;

/**
 * Request to toggle a resource's `starred` flag for the current user. `nodeId` is
 * the resource id (knr_…); `spaceId` scopes the per-user-state row. The write rides
 * the existing per-user-state path (own rows, verb space.knowledge.progress).
 */
export const starredToggleSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema,
  starred: z.boolean(),
});
export type StarredToggle = z.infer<typeof starredToggleSchema>;

export function parseStarredToggle(raw: unknown) {
  return starredToggleSchema.safeParse(raw);
}

/**
 * Open-record write contract. The thin `POST /author/graph/opened`
 * body: the resource the caller deliberately opened, in a space. Identity comes
 * from the SESSION (RLS), never the body — so this carries only the targeting keys.
 */
export const openedRecordSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema, // knr_…
});
export type OpenedRecord = z.infer<typeof openedRecordSchema>;

export function parseOpenedRecord(raw: unknown) {
  return openedRecordSchema.safeParse(raw);
}

/**
 * NATS activity envelope for the body-edit path. The
 * Payload `Bodies.afterChange` hook PUBLISHES this; the activity consumer worker
 * VALIDATES + ingests it into `kb.resource_activity` (source=`nats-body`). The
 * `event_id` doubles as the JetStream `Nats-Msg-Id` (producer dedupe) and the
 * `kb.resource_activity.event_id` (consumer idempotent append). A body edit is
 * NODE activity, not a per-user open — so the envelope carries no user_id.
 */
export const knowledgeActivityBodyEventSchema = z.object({
  event_id: z.string().min(1), // JetStream Nats-Msg-Id (UUID), NOT a kra_ entity id
  node_id: entityIds.knowledgeResource.prefixSchema, // knr_…
  space_id: entityIds.space.prefixSchema,
  occurred_at: z.string().datetime(),
});
export type KnowledgeActivityBodyEvent = z.infer<
  typeof knowledgeActivityBodyEventSchema
>;

export function parseKnowledgeActivityBodyEvent(raw: unknown) {
  return knowledgeActivityBodyEventSchema.safeParse(raw);
}

/**
 * JetStream stream / subject contract for the knowledge-activity namespace.
 * One stream over `knowledge.activity.v1.>`; the body-edit
 * producer publishes on `knowledge.activity.v1.body`. Fixed infra contracts live
 * in code, not env (monorepo-env-minimalism) — env may OVERRIDE the stream /
 * consumer name, but these are the defaults both producer and consumer share.
 */
export const KNOWLEDGE_ACTIVITY_STREAM_NAME = 'KNOWLEDGE_ACTIVITY' as const;
export const KNOWLEDGE_ACTIVITY_SUBJECT_PREFIX =
  'knowledge.activity.v1' as const;
export const KNOWLEDGE_ACTIVITY_SUBJECT_FILTER =
  'knowledge.activity.v1.>' as const;
export const KNOWLEDGE_ACTIVITY_BODY_SUBJECT =
  'knowledge.activity.v1.body' as const;
export const KNOWLEDGE_ACTIVITY_CONSUMER_NAME = 'author-activity-v1' as const;

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
