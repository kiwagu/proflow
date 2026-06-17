import type { WorkflowDefinition } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { validateTransition } from './workflow.validator.js';

// The document_review lifecycle (XState-compatible, ADR-0007). Pure: no DB.
const documentReview: WorkflowDefinition = {
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
    archived: { on: {} },
  },
};

describe('validateTransition — generic, data-driven, pure', () => {
  it('accepts a legal unguarded transition', () => {
    expect(
      validateTransition(documentReview, 'draft', 'in_review', new Set())
    ).toEqual({ ok: true });
  });

  it('rejects an unknown target state', () => {
    expect(
      validateTransition(documentReview, 'draft', 'nowhere', new Set())
    ).toEqual({ ok: false, reason: 'unknown_state' });
  });

  it('rejects a target with no declared transition from `from`', () => {
    // draft → archived is not declared (no event in draft.on targets archived)
    expect(
      validateTransition(documentReview, 'draft', 'archived', new Set())
    ).toEqual({ ok: false, reason: 'illegal_transition' });
  });

  it('rejects a transition from an unknown `from` state', () => {
    expect(
      validateTransition(documentReview, 'missing', 'in_review', new Set())
    ).toEqual({ ok: false, reason: 'illegal_transition' });
  });

  it('rejects a guarded transition when the verb is missing', () => {
    expect(
      validateTransition(documentReview, 'in_review', 'approved', new Set())
    ).toEqual({ ok: false, reason: 'guard_denied' });
  });

  it('accepts a guarded transition when the caller holds the guard verb', () => {
    expect(
      validateTransition(
        documentReview,
        'in_review',
        'approved',
        new Set(['space.knowledge.approve'])
      )
    ).toEqual({ ok: true });
  });

  it('accepts an unguarded transition out of a guarded state', () => {
    // in_review → draft (reject) needs no guard
    expect(
      validateTransition(documentReview, 'in_review', 'draft', new Set())
    ).toEqual({ ok: true });
  });
});
