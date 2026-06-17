import type {
  ProjectionResult,
  ResourceUserStateMap,
} from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { gateSequence } from './sequence-gating.js';

// Linear prerequisite chain L1 → L2 → L3 (the e2e bootstrap graph), ordered by
// the resolver into `items` (depth 0/1/2). Pure: no DB, no React.
function courseResult(): ProjectionResult {
  return {
    projection_id: 'prj_course',
    view: 'course',
    items: [
      {
        id: 'knr_l1',
        kind: 'text',
        title: 'L1',
        status: 'active',
        visibility: 'space',
        body_ref: null,
        depth: 0,
        via_edge_id: null,
      },
      {
        id: 'knr_l2',
        kind: 'text',
        title: 'L2',
        status: 'active',
        visibility: 'space',
        body_ref: null,
        depth: 1,
        via_edge_id: 'kne_1',
      },
      {
        id: 'knr_l3',
        kind: 'text',
        title: 'L3',
        status: 'active',
        visibility: 'space',
        body_ref: null,
        depth: 2,
        via_edge_id: 'kne_2',
      },
    ],
  };
}

function lockedById(course: ReturnType<typeof gateSequence>) {
  return Object.fromEntries(course.steps.map((s) => [s.id, s.locked]));
}

describe('gateSequence — display gating over per-user state (pure)', () => {
  it('empty state → only the first step unlocked', () => {
    const state: ResourceUserStateMap = {};
    const gated = gateSequence(courseResult(), state);
    expect(lockedById(gated)).toEqual({
      knr_l1: false,
      knr_l2: true,
      knr_l3: true,
    });
    // no row ⇒ coarse defaults to not_started
    expect(gated.steps[0]?.coarse_status).toBe('not_started');
  });

  it('first step done → second step unlocks, third stays locked', () => {
    const state: ResourceUserStateMap = { knr_l1: 'done' };
    const gated = gateSequence(courseResult(), state);
    expect(lockedById(gated)).toEqual({
      knr_l1: false,
      knr_l2: false,
      knr_l3: true,
    });
  });

  it('first two steps done → all three unlocked', () => {
    const state: ResourceUserStateMap = { knr_l1: 'done', knr_l2: 'done' };
    const gated = gateSequence(courseResult(), state);
    expect(lockedById(gated)).toEqual({
      knr_l1: false,
      knr_l2: false,
      knr_l3: false,
    });
  });

  it('all steps done → all unlocked', () => {
    const state: ResourceUserStateMap = {
      knr_l1: 'done',
      knr_l2: 'done',
      knr_l3: 'done',
    };
    const gated = gateSequence(courseResult(), state);
    expect(Object.values(lockedById(gated))).toEqual([false, false, false]);
  });

  it('in_progress on step 1 does NOT unlock step 2 (only done unlocks)', () => {
    const state: ResourceUserStateMap = { knr_l1: 'in_progress' };
    const gated = gateSequence(courseResult(), state);
    expect(lockedById(gated)).toEqual({
      knr_l1: false,
      knr_l2: true,
      knr_l3: true,
    });
  });

  it('preserves item order and echoes traversal context', () => {
    const gated = gateSequence(courseResult(), {});
    expect(gated.steps.map((s) => s.id)).toEqual([
      'knr_l1',
      'knr_l2',
      'knr_l3',
    ]);
    expect(gated.steps.map((s) => s.depth)).toEqual([0, 1, 2]);
    expect(gated.steps.map((s) => s.via_edge_id)).toEqual([
      null,
      'kne_1',
      'kne_2',
    ]);
  });

  it('locked steps remain present (authorization ≠ gating)', () => {
    const gated = gateSequence(courseResult(), {});
    // every input item is echoed even when locked — lock is display, not absence
    expect(gated.steps.map((s) => s.id)).toEqual([
      'knr_l1',
      'knr_l2',
      'knr_l3',
    ]);
    expect(gated.steps.find((s) => s.id === 'knr_l3')?.locked).toBe(true);
  });

  it('empty course → empty steps', () => {
    const gated = gateSequence(
      { projection_id: 'prj_x', view: 'course', items: [] },
      {}
    );
    expect(gated.steps).toEqual([]);
  });
});
