import { z } from 'zod';

/**
 * Resource-workflow as data (see docs/knowledge-graph-plan.md §5). A workflow is a
 * status state-machine held as DATA — states + allowed transitions + guards —
 * stored in `public.resource_workflows.definition` jsonb and validated at the app
 * boundary by this schema (the DB never cracks the jsonb, parity with how a
 * ProjectionSpec is parsed at the boundary). A new lifecycle is one more row, zero
 * migration.
 *
 * NORMATIVE FORM: the definition is stored in an XState-compatible
 * shape — `{ initial, states: { <state>: { on: { <event>: { target, guard? } } } } }`
 * — NOT a `transitions[]` array. Guards reference a permission-verb by STRING KEY.
 * This lets the thin in-house `validateTransition` read the definition directly
 * today AND lets `createMachine(config)` adopt it later with zero data migration.
 */

/** One transition: the target state + an optional guard verb required for it. */
export const workflowTransitionSchema = z.object({
  target: z.string(),
  // optional permission-verb key required for THIS transition (e.g.
  // 'space.knowledge.approve'); absence = the base write verb is enough.
  guard: z.string().optional(),
});
export type WorkflowTransition = z.infer<typeof workflowTransitionSchema>;

/** One state: a map of event name → the transition it triggers. */
export const workflowStateSchema = z.object({
  on: z.record(z.string(), workflowTransitionSchema).default({}), // event → transition
});
export type WorkflowState = z.infer<typeof workflowStateSchema>;

/**
 * A full workflow definition: an initial state + a map of declared states. Two
 * refinements keep stored definitions sound: (1) `initial` must be a declared
 * state; (2) every transition target must be a declared state (no dangling edges).
 */
export const workflowDefinitionSchema = z
  .object({
    initial: z.string(),
    states: z.record(z.string(), workflowStateSchema), // XState-compatible
  })
  .refine((d) => d.initial in d.states, {
    message: 'initial must be a declared state',
  })
  .refine(
    (d) =>
      Object.values(d.states).every((s) =>
        Object.values(s.on).every((t) => t.target in d.states)
      ),
    { message: 'every transition target must be a declared state' }
  );
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export function parseWorkflowDefinition(raw: unknown) {
  return workflowDefinitionSchema.safeParse(raw);
}
