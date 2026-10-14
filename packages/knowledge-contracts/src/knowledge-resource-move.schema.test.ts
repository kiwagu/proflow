import { describe, expect, it } from 'vitest';

import {
  moveKnowledgeResourceInputSchema,
  parseMoveKnowledgeResourceInput,
} from './knowledge-resource-move.schema.js';

describe('moveKnowledgeResourceInputSchema', () => {
  const validFolderMove = {
    spaceId: 'spc_01h4rswqtwd61c401kwytx54t',
    nodeId: 'knr_01h4rswqtwd61c401kwytx54a',
    targetParentId: 'knr_01h4rswqtwd61c401kwytx54b',
    position: 0,
  };

  const validTopLevelMove = {
    spaceId: 'spc_01h4rswqtwd61c401kwytx54t',
    nodeId: 'knr_01h4rswqtwd61c401kwytx54a',
    targetParentId: null,
    position: 3,
  };

  it('accepts valid move into a target folder', () => {
    const parsed = moveKnowledgeResourceInputSchema.parse(validFolderMove);
    expect(parsed).toEqual(validFolderMove);
    expect(parsed.targetParentId).toBe('knr_01h4rswqtwd61c401kwytx54b');
    expect(parsed.position).toBe(0);
  });

  it('accepts valid move to top level (targetParentId === null)', () => {
    const parsed = moveKnowledgeResourceInputSchema.parse(validTopLevelMove);
    expect(parsed).toEqual(validTopLevelMove);
    expect(parsed.targetParentId).toBeNull();
    expect(parsed.position).toBe(3);
  });

  it('safeParse helper succeeds on valid inputs', () => {
    const result = parseMoveKnowledgeResourceInput(validFolderMove);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFolderMove);
    }
  });

  it('rejects self-parent (nodeId === targetParentId)', () => {
    const selfParent = {
      ...validFolderMove,
      targetParentId: validFolderMove.nodeId,
    };
    const result = parseMoveKnowledgeResourceInput(selfParent);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['targetParentId']);
      expect(result.error.issues[0]?.message).toBe(
        'nodeId cannot be its own targetParentId'
      );
    }
  });

  it('rejects invalid spaceId entity prefix', () => {
    const invalidSpace = {
      ...validFolderMove,
      spaceId: 'knr_01h4rswqtwd61c401kwytx54t',
    };
    const result = parseMoveKnowledgeResourceInput(invalidSpace);
    expect(result.success).toBe(false);
  });

  it('rejects invalid nodeId entity prefix', () => {
    const invalidNode = {
      ...validFolderMove,
      nodeId: 'spc_01h4rswqtwd61c401kwytx54a',
    };
    const result = parseMoveKnowledgeResourceInput(invalidNode);
    expect(result.success).toBe(false);
  });

  it('rejects invalid targetParentId entity prefix', () => {
    const invalidTarget = {
      ...validFolderMove,
      targetParentId: 'usr_01h4rswqtwd61c401kwytx54b',
    };
    const result = parseMoveKnowledgeResourceInput(invalidTarget);
    expect(result.success).toBe(false);
  });

  it('rejects negative position', () => {
    const negativePos = {
      ...validFolderMove,
      position: -1,
    };
    const result = parseMoveKnowledgeResourceInput(negativePos);
    expect(result.success).toBe(false);
  });

  it('rejects fractional/non-integer position', () => {
    const fractionalPos = {
      ...validFolderMove,
      position: 1.5,
    };
    const result = parseMoveKnowledgeResourceInput(fractionalPos);
    expect(result.success).toBe(false);
  });

  it('rejects undefined targetParentId (must be null or valid knr id)', () => {
    const missingTarget = {
      spaceId: validFolderMove.spaceId,
      nodeId: validFolderMove.nodeId,
      position: 0,
    };
    const result = parseMoveKnowledgeResourceInput(missingTarget);
    expect(result.success).toBe(false);
  });
});
