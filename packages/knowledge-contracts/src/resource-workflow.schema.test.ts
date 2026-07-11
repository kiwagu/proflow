import { describe, expect, it } from 'vitest';

import {
  parseWorkflowDefinition,
  workflowDefinitionSchema,
} from './resource-workflow.schema.js';

/**
 * The `document_review` workflow definition is the exact jsonb the seed migration
 * writes into `public.resource_workflows.definition`; parsing it here keeps the
 * stored data and the contract in lock-step (a new lifecycle is one parse-valid
 * row, never a schema change). XState-compatible form.
 */
const documentReview = {
  initial: 'draft',
  states: {
    draft: { on: { submit: { target: 'in_review' } } },
    in_review: {
      on: {
        approve: { target: 'approved', guard: 'space.knowledge.approve' },
        reject: { target: 'draft' },
      },
    },
    approved: { on: { archive: { target: 'archived' } } },
    archived: {},
  },
} as const;

const defaultWorkflow = {
  initial: 'draft',
  states: {
    draft: { on: { activate: { target: 'active' } } },
    active: { on: { archive: { target: 'archived' } } },
    archived: {},
  },
} as const;

describe('workflowDefinitionSchema', () => {
  it('round-trips the document_review seed definition', () => {
    const parsed = workflowDefinitionSchema.parse(documentReview);
    expect(parsed.initial).toBe('draft');
    expect(parsed.states.in_review?.on.approve?.target).toBe('approved');
    expect(parsed.states.in_review?.on.approve?.guard).toBe(
      'space.knowledge.approve'
    );
  });

  it('round-trips the default seed definition', () => {
    const parsed = workflowDefinitionSchema.parse(defaultWorkflow);
    expect(parsed.initial).toBe('draft');
    expect(parsed.states.archived?.on).toEqual({});
  });

  it('applies the default empty `on` map for a terminal state', () => {
    const parsed = workflowDefinitionSchema.parse({
      initial: 'a',
      states: { a: {} },
    });
    expect(parsed.states.a?.on).toEqual({});
  });

  it('rejects an `initial` that is not a declared state', () => {
    const result = parseWorkflowDefinition({
      initial: 'missing',
      states: { draft: {} },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a transition target that is not a declared state', () => {
    const result = parseWorkflowDefinition({
      initial: 'draft',
      states: { draft: { on: { go: { target: 'nowhere' } } } },
    });
    expect(result.success).toBe(false);
  });
});
