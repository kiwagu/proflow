import type {
  ProjectionResult,
  ResourceUserStateMap,
} from '@workspace/knowledge-contracts';
import { z } from 'zod';

import { gateSequence } from './sequence-gating.js';

/**
 * Gating rule registry (slice-06 §3 / docs/knowledge-graph-plan.md §5). The gating
 * layer is a PLUGGABLE RULE REGISTRY mirroring the view registry: a ProjectionSpec
 * declares which named rule applies, and the engine resolves it here. A new
 * gating kind is one more registry entry, NOT an engine fork.
 *
 * A gating rule is a pure, UI-agnostic, DB-free, React-free predicate over the
 * gating context `(user-state | resource-state | graph)`. This is DISPLAY gating,
 * NOT access control (ADR-0006 §2): the resolver already decided access via RLS —
 * a gated node STAYS in the result, `available=false` only expresses business
 * closure. Rule keys are neutral by mechanism (`sequence`, `requires_state`),
 * never by application.
 */

/** Per-node gating verdict. `available` is a COMPUTED display flag, not an access denial. */
export type NodeGate = {
  id: string; // knr_… (echo of item.id)
  available: boolean; // is the node open/actionable right now
  reason?: string; // neutral i18n reason code, e.g. 'prereq_incomplete' | 'status_not_allowed'
  // traversal context echoed so the view never recomputes the traversal:
  depth: number;
  via_edge_id: string | null;
  coarse_status?: string; // for the sequence rule (user-state)
  status?: string; // for the requires_state rule (resource-state)
};

export type GatingResult = { nodes: NodeGate[] }; // same order as result.items

/** Context available to any rule; a rule reads what it needs and ignores the rest. */
export type GatingCtx = {
  userStateMap?: ResourceUserStateMap; // per-user (slice-05)
  resourceStateMap?: Record<string, string>; // node_id → workflow status (this slice)
  // graph context is already inside result.items (depth/via_edge_id/order); scope = future
  params?: Record<string, unknown>; // the ProjectionSpec.gating.params for this rule
};

/** A gating rule = a pure predicate (result, ctx) → per-node verdict. */
export type GatingRule = (
  result: ProjectionResult,
  ctx: GatingCtx
) => GatingResult;

/**
 * `sequence` rule — a THIN adapter over the existing `gateSequence`
 * (sequence-gating.ts), the slice-05 linear-prerequisite rule. It is NOT modified
 * or broken here; this wrapper calls it and maps `GatedStep[] → NodeGate[]`
 * (`locked` → `available = !locked`, `coarse_status` passed through). The course
 * path stays green either through the direct call or through this registry entry.
 */
export const sequenceRule: GatingRule = (result, ctx) => {
  const gated = gateSequence(result, ctx.userStateMap ?? {});
  return {
    nodes: gated.steps.map((step) => ({
      id: step.id,
      available: !step.locked,
      reason: step.locked ? 'prereq_incomplete' : undefined,
      depth: step.depth,
      via_edge_id: step.via_edge_id,
      coarse_status: step.coarse_status,
    })),
  };
};

/** Params shape for `requires_state`; the rule parses its own params (generic contract). */
const requiresStateParamsSchema = z.object({
  allowed: z.array(z.string()),
});

/**
 * `requires_state` rule (new) — a node is available iff its RESOURCE status is in
 * the allowed set. The status source is `ctx.resourceStateMap` (built from the
 * already-resolved `result.items[].status`, no second fetch) or `item.status`
 * directly. Pure, no DB, no user-state — it demonstrates the registry hosting
 * rules over DIFFERENT context sources (ADR-0006 §2/§4).
 *
 * DISPLAY gating: a node whose status is not allowed STAYS in the output with
 * `available=false` (ADR-0006 §2 — closure ≠ absence).
 */
export const requiresStateRule: GatingRule = (result, ctx) => {
  const { allowed } = requiresStateParamsSchema.parse(ctx.params ?? {});
  const allowedSet = new Set(allowed);
  return {
    nodes: result.items.map((item) => {
      const status = ctx.resourceStateMap?.[item.id] ?? item.status;
      const available = allowedSet.has(status);
      return {
        id: item.id,
        available,
        reason: available ? undefined : 'status_not_allowed',
        depth: item.depth,
        via_edge_id: item.via_edge_id,
        status,
      };
    }),
  };
};

export const GATING_RULE_REGISTRY: Record<string, GatingRule> = {
  sequence: sequenceRule, // §3.2 — wrapper over the existing gateSequence
  requires_state: requiresStateRule, // §3.3 — new
};

export function resolveGatingRule(key: string): GatingRule | undefined {
  return GATING_RULE_REGISTRY[key];
}
