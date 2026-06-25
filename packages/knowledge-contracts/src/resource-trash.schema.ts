import { z } from 'zod';

/**
 * Trash lifecycle contracts (ADR-0018). The three frozen-v1 operations over a
 * knowledge resource's existence axis (`deleted_at`):
 *
 *   - trash   — soft-delete a resource/subtree (reversible holding state);
 *   - restore — bring a trashed resource (and its trashed-as-a-unit subtree) back;
 *   - purge   — permanently destroy a trashed resource (a real DELETE, one-way).
 *
 * These are DOMAIN input contracts, not transport envelopes. They carry ONLY the
 * scope + target ids; authority (owner-sovereign OR `space.knowledge.delete`,
 * and the in-use purge guard) is enforced by Postgres RLS + triggers, never by
 * these schemas (zod-schema-first-contracts: shape at the boundary, fence in the DB).
 *
 * Lifecycle is orthogonal to access (`visibility`) and workflow (`status`): trash
 * never reads or writes either. There is NO `deleted_at` value in the input — trash
 * stamps `now()` server-side; restore clears it; the timestamp is never client-set.
 */

/** Trash a resource (and soft-cascade its containment orphans). */
export const trashResourceInputSchema = z.object({
  spaceId: z.string().min(1),
  resourceId: z.string().min(1), // knr_… the selected node
});
export type TrashResourceInput = z.infer<typeof trashResourceInputSchema>;

/** Restore a trashed resource (and its trashed-as-a-unit subtree). */
export const restoreResourceInputSchema = z.object({
  spaceId: z.string().min(1),
  resourceId: z.string().min(1), // knr_… the trashed node
});
export type RestoreResourceInput = z.infer<typeof restoreResourceInputSchema>;

/** Permanently destroy a trashed resource (manual purge from the Trash lens). */
export const purgeResourceInputSchema = z.object({
  spaceId: z.string().min(1),
  resourceId: z.string().min(1), // knr_… the trashed node (always destroyed)
});
export type PurgeResourceInput = z.infer<typeof purgeResourceInputSchema>;

export function parseTrashResourceInput(raw: unknown) {
  return trashResourceInputSchema.safeParse(raw);
}
export function parseRestoreResourceInput(raw: unknown) {
  return restoreResourceInputSchema.safeParse(raw);
}
export function parsePurgeResourceInput(raw: unknown) {
  return purgeResourceInputSchema.safeParse(raw);
}
