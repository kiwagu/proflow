import type { Database } from '@workspace/db';
import {
  resourceUserStateMapSchema,
  type CoarseStatus,
  type ResourceUserStateMap,
} from '@workspace/knowledge-contracts/resource-user-state';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-user state — UI-AGNOSTIC application module (ADR-0005 guardrail b /
 * slice-05 §5.2). The thin route-handler delegates here; this module holds the
 * domain write/read of the per-user progress anchor and knows nothing about the
 * transport or any UI.
 *
 * Discipline B: every Postgres access runs under the USER's RLS-scoped `db`,
 * NEVER service-role. The `user_id` is taken from the authenticated SESSION
 * (passed in `ctx.userId`), NEVER from the request body — a forged body cannot
 * write someone else's row, and even if it tried, the RLS WITH CHECK
 * (user_id = auth.uid()) is the final gate.
 */

export type SetResourceUserStateInput = {
  spaceId: string;
  resourceId: string; // knr_…
  coarseStatus: CoarseStatus;
};

export type SetResourceUserStateDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (from the session, NOT the request body). */
  userId: string;
};

export type SetResourceUserStateResult = {
  resource_id: string;
  coarse_status: CoarseStatus;
};

/**
 * Upsert a single (user, resource) progress row under the user's RLS client.
 * `user_id` comes from the session; the same-space trigger + own-rows RLS are the
 * double safety net. POC mark-complete sends coarse_status='done'; the contract
 * allows the full coarse set so future `in_progress` moves need no endpoint change.
 */
export async function setResourceUserState(
  input: SetResourceUserStateInput,
  ctx: SetResourceUserStateDeps
): Promise<SetResourceUserStateResult> {
  const { data, error } = await ctx.db
    .from('resource_user_state')
    .upsert(
      {
        user_id: ctx.userId,
        resource_id: input.resourceId,
        space_id: input.spaceId,
        coarse_status: input.coarseStatus,
      },
      { onConflict: 'user_id,resource_id' }
    )
    .select('resource_id,coarse_status')
    .single();

  if (error || !data) {
    // RLS rejection (no space.knowledge.progress, or a forged foreign user_id)
    // lands here — a clean failure, nothing written.
    throw new Error(`setResourceUserState: ${error?.message ?? 'no row'}`);
  }

  return {
    resource_id: data.resource_id,
    coarse_status: data.coarse_status as CoarseStatus,
  };
}

/**
 * Overlay fetch: all of MY rows in a space → a map node_id → coarse_status (the
 * input to `gateSequence`). Own-rows RLS already filters to the caller's rows, so
 * no `user_id` filter is needed here — the policy guarantees isolation.
 */
export async function loadResourceUserStateMap(
  spaceId: string,
  ctx: { db: SupabaseClient<Database> }
): Promise<ResourceUserStateMap> {
  const { data, error } = await ctx.db
    .from('resource_user_state')
    .select('resource_id,coarse_status')
    .eq('space_id', spaceId);

  if (error) {
    throw new Error(`loadResourceUserStateMap: ${error.message}`);
  }

  const raw: Record<string, string> = {};
  for (const row of data ?? []) {
    raw[row.resource_id] = row.coarse_status;
  }

  // Validate at the app boundary (zod) — never trust stored shape blindly.
  const parsed = resourceUserStateMapSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      'loadResourceUserStateMap: invalid coarse_status in row set'
    );
  }
  return parsed.data;
}
