import type {
  ProjectionResult,
  ResourceUserStateMap,
} from '@workspace/knowledge-contracts';

/**
 * Ordered-sequence gating — a pure, UI-agnostic, DB-free, React-free domain rule (slice-05
 * §3 / docs/knowledge-graph-plan.md §2). It overlays a user's per-resource state
 * onto an ordered (e.g. course) result and computes a per-step locked/unlocked flag.
 *
 * This is DISPLAY gating, NOT access control (ADR-0004 §3). The resolver already
 * decided access via RLS — every step the user may see is in `result.items`. A
 * locked step is still present in `items`; `locked` only expresses pedagogical
 * closure. The resolver stays projection-PURE; this is a separate layer merged at
 * render time.
 */

export type GatedStep = {
  id: string; // knr_… (echo of item.id)
  locked: boolean; // COMPUTED display state — NOT an access denial
  coarse_status: string; // from the overlay; 'not_started' when no row exists
  // traversal context echoed so the view never recomputes the traversal:
  depth: number;
  via_edge_id: string | null;
};

export type GatedSequence = {
  steps: GatedStep[]; // same order as result.items (resolver materialized it)
};

/**
 * Overlay the user's per-resource state onto an ordered course result.
 *
 * Unlock rule (POC, linear prerequisite chain): a step is unlocked iff EVERY
 * preceding step in the ordered chain is `done`. Equivalently: the first
 * not-`done` step and everything before it is unlocked; everything after the
 * first not-`done` step is locked. The start step is always unlocked (the
 * "all prior done" predicate is vacuously true for it).
 *
 * The resolver returns `items` already in prerequisite order, so "all prior in
 * order are done" equals "all prerequisites are done" for a linear chain. A
 * non-linear DAG (a node with several prerequisites) needs gating over the actual
 * incoming edges — deferred.
 */
export function gateSequence(
  result: ProjectionResult,
  state: ResourceUserStateMap
): GatedSequence {
  let allPriorDone = true;

  const steps: GatedStep[] = result.items.map((item) => {
    const coarse = state[item.id] ?? 'not_started';
    const locked = !allPriorDone;
    // fold AFTER computing this step's lock, so a step is unlocked exactly when
    // all steps BEFORE it are done (the start step is always unlocked).
    allPriorDone = allPriorDone && coarse === 'done';
    return {
      id: item.id,
      locked,
      coarse_status: coarse,
      depth: item.depth,
      via_edge_id: item.via_edge_id,
    };
  });

  return { steps };
}
