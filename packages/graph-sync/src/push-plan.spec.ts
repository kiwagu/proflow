import { describe, expect, it } from 'vitest';
import { planWrites } from './push-plan.js';
import type { JournaledOp } from './types.js';

const SPACE = 'spc_0000000000000001.0000000000';
const NODE = 'knr_0000000000000001.0000000000';
const TARGET = 'knr_0000000000000002.0000000000';
const identity = { userId: '00000000-0000-4000-8000-000000000001' };

function moveOp(payload: Record<string, unknown>): JournaledOp {
  return {
    id: 1,
    spaceId: SPACE,
    op: 'move_node',
    payload,
    nodeIds: [NODE, TARGET],
  };
}

describe('planWrites — move_node', () => {
  it('plans exactly one rpc write carrying the four p_* arguments', () => {
    const writes = planWrites(
      moveOp({
        spaceId: SPACE,
        nodeId: NODE,
        targetParentId: TARGET,
        position: 3,
      }),
      identity
    );
    expect(writes).toEqual([
      {
        kind: 'rpc',
        fn: 'move_knowledge_resource',
        args: {
          p_space_id: SPACE,
          p_node_id: NODE,
          p_target_parent_id: TARGET,
          p_position: 3,
        },
      },
    ]);
  });

  it('carries a null target for a move to the top level', () => {
    const [write] = planWrites(
      moveOp({
        spaceId: SPACE,
        nodeId: NODE,
        targetParentId: null,
        position: 0,
      }),
      identity
    );
    expect(write?.kind).toBe('rpc');
    if (write?.kind !== 'rpc') return;
    expect(write.args['p_target_parent_id']).toBeNull();
  });

  it('throws on a payload the contract refuses instead of planning a write', () => {
    expect(() =>
      planWrites(
        moveOp({
          spaceId: SPACE,
          nodeId: NODE,
          targetParentId: NODE,
          position: 0,
        }),
        identity
      )
    ).toThrow();
  });
});
