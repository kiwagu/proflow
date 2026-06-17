import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import {
  GATING_RULE_REGISTRY,
  requiresStateRule,
  resolveGatingRule,
} from './gating-registry.js';

// A board projection over three documents with different statuses. Pure: no DB,
// no React (parity with sequence-gating.test.ts).
function docResult(): ProjectionResult {
  return {
    projection_id: 'prj_docs',
    view: 'board',
    items: [
      {
        id: 'knr_d1',
        kind: 'text',
        title: 'D1',
        status: 'draft',
        visibility: 'space',
        body_ref: null,
        depth: 0,
        via_edge_id: null,
      },
      {
        id: 'knr_d2',
        kind: 'text',
        title: 'D2',
        status: 'in_review',
        visibility: 'space',
        body_ref: null,
        depth: 0,
        via_edge_id: null,
      },
      {
        id: 'knr_d3',
        kind: 'text',
        title: 'D3',
        status: 'approved',
        visibility: 'space',
        body_ref: null,
        depth: 0,
        via_edge_id: null,
      },
    ],
  };
}

function availableById(result: ReturnType<typeof requiresStateRule>) {
  return Object.fromEntries(result.nodes.map((n) => [n.id, n.available]));
}

describe('requiresStateRule — display gating over resource status (pure)', () => {
  it('allowed=[approved] → only approved available, others not', () => {
    const gated = requiresStateRule(docResult(), {
      params: { allowed: ['approved'] },
    });
    expect(availableById(gated)).toEqual({
      knr_d1: false,
      knr_d2: false,
      knr_d3: true,
    });
  });

  it('a non-available node REMAINS in the output (display, not access)', () => {
    const gated = requiresStateRule(docResult(), {
      params: { allowed: ['approved'] },
    });
    // every input item is echoed even when not available — closure ≠ absence
    expect(gated.nodes.map((n) => n.id)).toEqual([
      'knr_d1',
      'knr_d2',
      'knr_d3',
    ]);
    const draft = gated.nodes.find((n) => n.id === 'knr_d1');
    expect(draft?.available).toBe(false);
    expect(draft?.reason).toBe('status_not_allowed');
    expect(draft?.status).toBe('draft');
  });

  it('an available node carries no reason and echoes its status', () => {
    const gated = requiresStateRule(docResult(), {
      params: { allowed: ['approved'] },
    });
    const approved = gated.nodes.find((n) => n.id === 'knr_d3');
    expect(approved?.available).toBe(true);
    expect(approved?.reason).toBeUndefined();
    expect(approved?.status).toBe('approved');
  });

  it('prefers ctx.resourceStateMap over item.status when provided', () => {
    const gated = requiresStateRule(docResult(), {
      params: { allowed: ['approved'] },
      resourceStateMap: { knr_d1: 'approved' }, // override the draft status
    });
    expect(availableById(gated).knr_d1).toBe(true);
  });

  it('a wider allowed set opens more nodes', () => {
    const gated = requiresStateRule(docResult(), {
      params: { allowed: ['in_review', 'approved'] },
    });
    expect(availableById(gated)).toEqual({
      knr_d1: false,
      knr_d2: true,
      knr_d3: true,
    });
  });

  it('rejects params missing the allowed array (rule parses its own params)', () => {
    expect(() => requiresStateRule(docResult(), { params: {} })).toThrow();
  });
});

describe('GATING_RULE_REGISTRY', () => {
  it('hosts both the sequence and requires_state rules', () => {
    expect(Object.keys(GATING_RULE_REGISTRY).sort()).toEqual([
      'requires_state',
      'sequence',
    ]);
  });

  it('resolveGatingRule returns the rule for a known key', () => {
    expect(resolveGatingRule('requires_state')).toBe(requiresStateRule);
  });

  it('resolveGatingRule returns undefined for an unknown key', () => {
    expect(resolveGatingRule('nope')).toBeUndefined();
  });
});
