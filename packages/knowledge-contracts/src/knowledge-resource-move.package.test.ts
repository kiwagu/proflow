import { describe, expect, it } from 'vitest';
import { parseMoveKnowledgeResourceInput } from '@workspace/knowledge-contracts';
import { moveKnowledgeResourceInputSchema } from '@workspace/knowledge-contracts/knowledge-resource-move';

describe('knowledge resource move package boundary', () => {
  const input = {
    spaceId: 'spc_01h4rswqtwd61c401kwytx54t',
    nodeId: 'knr_01h4rswqtwd61c401kwytx54a',
    targetParentId: null,
    position: 0,
  };

  it('accepts a serialized top-level move through both public exports', () => {
    const wireInput: unknown = JSON.parse(JSON.stringify(input));
    expect(parseMoveKnowledgeResourceInput(wireInput)).toEqual({
      success: true,
      data: input,
    });
    expect(moveKnowledgeResourceInputSchema.parse(wireInput)).toEqual(input);
  });

  it('does not propagate an actor supplied by the caller', () => {
    expect(
      moveKnowledgeResourceInputSchema.parse({
        ...input,
        actorId: 'caller-controlled-actor',
        userId: 'caller-controlled-user',
      })
    ).toEqual(input);
  });

  it('rejects a wire payload that coerces a position to a string', () => {
    expect(
      parseMoveKnowledgeResourceInput({ ...input, position: '0' }).success
    ).toBe(false);
  });
});
