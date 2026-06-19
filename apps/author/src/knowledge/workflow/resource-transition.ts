import type { Database } from '@workspace/db';
import { parseWorkflowDefinition } from '@workspace/knowledge-contracts/resource-workflow';
import { validateTransition } from '@workspace/knowledge-engine';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resource workflow transition — UI-AGNOSTIC application module (ADR-0005
 * guardrail b / slice-06 §5.2). The thin route-handler delegates here; this module
 * holds the domain read/validate/write of a status transition and knows nothing
 * about the transport or any UI.
 *
 * Discipline B: every Postgres access runs under the USER's RLS-scoped `db`,
 * NEVER service-role. The `user_id` and `userVerbs` come from the authenticated
 * SESSION / the user's roles (passed in `ctx`), NEVER from the request body.
 *
 * Double safety net (slice-06 §5.2): the generic `validateTransition` (engine)
 * rejects an illegal/unauthorized move BEFORE any write; the knowledge_resources
 * UPDATE RLS policy (base write verb) is the hard authority for the write itself.
 */

/** Domain error for an illegal/unauthorized transition → the endpoint maps it to 422. */
export class IllegalTransitionError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Illegal workflow transition: ${reason}`);
    this.name = 'IllegalTransitionError';
    this.reason = reason;
  }
}

export type TransitionResourceStatusInput = {
  spaceId: string;
  resourceId: string; // knr_…
  toStatus: string; // target status — legality is decided by the validator
};

export type TransitionResourceStatusDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (from the session, NOT the request body). */
  userId: string;
  /** Verbs the caller holds in this space (from roles, NOT the body) — guard checks. */
  userVerbs: Set<string>;
};

export type TransitionResourceStatusResult = {
  resource_id: string;
  status: string;
};

/**
 * Transition a node's status under the user's RLS client:
 *  1. read the node's current status + workflow_key (RLS guarantees read access);
 *  2. load resource_workflows.definition by workflow_key (or 'default');
 *  3. validate the transition with the generic engine validator (pure);
 *  4. if legal → update knowledge_resources.status under RLS;
 *  5. if illegal → throw IllegalTransitionError (endpoint → 422).
 */
export async function transitionResourceStatus(
  input: TransitionResourceStatusInput,
  ctx: TransitionResourceStatusDeps
): Promise<TransitionResourceStatusResult> {
  // 1) current status + workflow_key (read under RLS — unreadable node ⇒ no row)
  const { data: node, error: readErr } = await ctx.db
    .from('knowledge_resources')
    .select('id,status,workflow_key')
    .eq('id', input.resourceId)
    .eq('space_id', input.spaceId)
    .single();

  if (readErr || !node) {
    // RLS denied read, or the node does not exist — treat as not found / no access.
    throw new Error(
      `transitionResourceStatus: ${readErr?.message ?? 'resource not found'}`
    );
  }

  // 2) load the workflow definition (the node's, or the 'default' lifecycle)
  const workflowKey = node.workflow_key ?? 'default';
  const { data: workflow, error: wfErr } = await ctx.db
    .from('resource_workflows')
    .select('definition')
    .eq('key', workflowKey)
    .single();

  if (wfErr || !workflow) {
    throw new Error(
      `transitionResourceStatus: unknown workflow '${workflowKey}'`
    );
  }

  const parsed = parseWorkflowDefinition(workflow.definition);
  if (!parsed.success) {
    throw new Error(
      `transitionResourceStatus: invalid workflow definition '${workflowKey}'`
    );
  }

  // 3) validate the transition (pure, data-driven) — illegal ⇒ domain error (422)
  const verdict = validateTransition(
    parsed.data,
    node.status,
    input.toStatus,
    ctx.userVerbs
  );
  if (!verdict.ok) {
    throw new IllegalTransitionError(verdict.reason);
  }

  // 4) legal → update status under RLS (the UPDATE policy is the hard authority)
  const { data: updated, error: updErr } = await ctx.db
    .from('knowledge_resources')
    .update({ status: input.toStatus })
    .eq('id', input.resourceId)
    .eq('space_id', input.spaceId)
    .select('id,status')
    .single();

  if (updErr || !updated) {
    // RLS rejection (no write verb) lands here — a clean failure, nothing written.
    throw new Error(
      `transitionResourceStatus: ${updErr?.message ?? 'update rejected'}`
    );
  }

  return { resource_id: updated.id, status: updated.status };
}
