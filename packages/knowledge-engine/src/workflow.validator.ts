import type { WorkflowDefinition } from '@workspace/knowledge-contracts';

/**
 * Generic workflow transition validator (slice-06 §5.2). A pure, UI-agnostic,
 * DB-free, React-free domain function: given a workflow DEFINITION (data) and a
 * requested `from → to` move, it decides whether the move is legal and authorized.
 *
 * It reads the XState-compatible definition: a move `from → to` is
 * legal iff (1) `to` is a declared state, (2) some event in `states[from].on`
 * targets `to`, and (3) if that transition declares a `guard`, the caller holds
 * that verb. The engine is generic; a new lifecycle is a new `resource_workflows`
 * row, never new code.
 *
 * This is one half of the double safety net: the validator rejects an illegal or
 * unauthorized move BEFORE any write; Postgres RLS (the base write verb on
 * knowledge_resources) is the hard authority for the write itself.
 */

export type ValidateTransitionResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unknown_state' | 'illegal_transition' | 'guard_denied';
    };

export function validateTransition(
  definition: WorkflowDefinition,
  from: string,
  to: string,
  userVerbs: Set<string>
): ValidateTransitionResult {
  // (1) the target must be a declared state
  if (!(to in definition.states)) {
    return { ok: false, reason: 'unknown_state' };
  }

  const fromState = definition.states[from];
  // an unknown `from` cannot declare any transition → illegal
  if (!fromState) {
    return { ok: false, reason: 'illegal_transition' };
  }

  // (2) some event in states[from].on must target `to`
  const transition = Object.values(fromState.on).find((t) => t.target === to);
  if (!transition) {
    return { ok: false, reason: 'illegal_transition' };
  }

  // (3) if the transition declares a guard verb, the caller must hold it
  if (transition.guard && !userVerbs.has(transition.guard)) {
    return { ok: false, reason: 'guard_denied' };
  }

  return { ok: true };
}
