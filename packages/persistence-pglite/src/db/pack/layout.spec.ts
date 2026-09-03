import { describe, expect, it } from 'vitest';
import {
  BLOCK_SIZE,
  BlockAllocator,
  capacityOf,
  ensureCapacity,
  INITIAL_MODE,
  newState,
  type PackFileNode,
  parseState,
  planIo,
  shrinkTo,
} from './layout.js';

const file = (): PackFileNode => ({
  type: 'file',
  mode: INITIAL_MODE.FILE,
  lastModified: 0,
  size: 0,
  extents: [],
});

describe('BlockAllocator', () => {
  it('hands out blocks from the end of an empty pack, contiguously', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    expect(a.allocate(3)).toEqual([{ start: 0, count: 3 }]);
    expect(a.allocate(2)).toEqual([{ start: 3, count: 2 }]);
    expect(state.endBlock).toBe(5);
  });

  it('continues a file in place when the block after it is the end of the pack', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    a.allocate(4);
    expect(a.allocate(2, 4)).toEqual([{ start: 4, count: 2 }]);
  });

  it('reuses freed blocks first, coalescing neighbours', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    a.allocate(10);
    a.release([{ start: 2, count: 2 }]);
    a.release([{ start: 4, count: 3 }]);
    expect(state.free).toEqual([{ start: 2, count: 5 }]);
    expect(a.allocate(4)).toEqual([{ start: 2, count: 4 }]);
    expect(state.free).toEqual([{ start: 6, count: 1 }]);
  });

  it('spans several free extents and the end of the pack when needed', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    a.allocate(10);
    a.release([{ start: 1, count: 1 }]);
    a.release([{ start: 5, count: 2 }]);
    expect(a.allocate(5)).toEqual([
      { start: 1, count: 1 },
      { start: 5, count: 2 },
      { start: 10, count: 2 },
    ]);
    expect(state.free).toEqual([]);
    expect(state.endBlock).toBe(12);
  });

  it('gives trailing free space back to the pack', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    a.allocate(6);
    a.release([{ start: 4, count: 2 }]);
    expect(state.endBlock).toBe(4);
    a.release([{ start: 2, count: 2 }]);
    expect(state.endBlock).toBe(2);
    expect(state.free).toEqual([]);
  });

  it('prefers the free extent right after a file when growing it', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    a.allocate(8);
    a.release([{ start: 3, count: 2 }]);
    a.release([{ start: 6, count: 2 }]);
    // A file ending at block 3 grows into the hole at 3, not the one at 6.
    expect(a.allocate(1, 3)).toEqual([{ start: 3, count: 1 }]);
  });
});

describe('file capacity', () => {
  it('grows a file in whole blocks and keeps its extents merged', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    const f = file();
    ensureCapacity(f, 1, a);
    expect(f.extents).toEqual([{ start: 0, count: 1 }]);
    ensureCapacity(f, BLOCK_SIZE * 3 + 1, a);
    expect(f.extents).toEqual([{ start: 0, count: 4 }]);
    expect(capacityOf(f)).toBe(BLOCK_SIZE * 4);
    expect(ensureCapacity(f, BLOCK_SIZE * 2, a)).toEqual([]);
  });

  it('shrinks a file and frees what it no longer needs', () => {
    const state = newState();
    const a = new BlockAllocator(state);
    const f = file();
    ensureCapacity(f, BLOCK_SIZE * 5, a);
    const g = file();
    ensureCapacity(g, BLOCK_SIZE, a);
    shrinkTo(f, BLOCK_SIZE + 1, a);
    expect(f.extents).toEqual([{ start: 0, count: 2 }]);
    expect(state.free).toEqual([{ start: 2, count: 3 }]);
    shrinkTo(f, 0, a);
    expect(f.extents).toEqual([]);
    expect(state.free).toEqual([{ start: 0, count: 5 }]);
  });
});

describe('planIo', () => {
  it('maps a range inside one extent', () => {
    const f = file();
    f.extents = [{ start: 4, count: 2 }];
    expect(planIo(f, 100, 50)).toEqual([
      { at: 4 * BLOCK_SIZE + 100, offset: 0, length: 50 },
    ]);
  });

  it('splits a range across extents and stops at the allocation', () => {
    const f = file();
    f.extents = [
      { start: 0, count: 1 },
      { start: 7, count: 1 },
    ];
    expect(planIo(f, BLOCK_SIZE - 10, 30)).toEqual([
      { at: BLOCK_SIZE - 10, offset: 0, length: 10 },
      { at: 7 * BLOCK_SIZE, offset: 10, length: 20 },
    ]);
    // Past the second block there is nothing: the caller zero-fills.
    expect(planIo(f, 2 * BLOCK_SIZE - 5, 100)).toEqual([
      { at: 8 * BLOCK_SIZE - 5, offset: 0, length: 5 },
    ]);
    expect(planIo(f, 5 * BLOCK_SIZE, 10)).toEqual([]);
  });
});

describe('parseState', () => {
  it('accepts its own documents and rejects anything else', () => {
    const state = newState();
    expect(parseState(JSON.stringify(state))).toEqual(state);
    expect(parseState('')).toBeNull();
    expect(parseState('{"root":{"type":"directory"},"pool":[]}')).toBeNull();
    expect(
      parseState(JSON.stringify({ ...state, blockSize: 4096 }))
    ).toBeNull();
  });
});

describe('compaction', () => {
  it('moves every live extent down in disk order and drops the free list', async () => {
    const { applyCompaction, planCompaction } = await import('./layout.js');
    const state = newState();
    const a = new BlockAllocator(state);
    const f1 = file();
    const f2 = file();
    ensureCapacity(f1, BLOCK_SIZE * 3, a); // blocks 0-2
    ensureCapacity(f2, BLOCK_SIZE * 2, a); // blocks 3-4
    ensureCapacity(f1, BLOCK_SIZE * 5, a); // blocks 5-6 (f1 is now two extents)
    state.root.children = { f1, f2 };
    shrinkTo(f2, 0, a); // frees 3-4
    f2.size = 0;
    const plan = planCompaction(state.root);
    // Only the extent above the hole moves, and it moves down.
    expect(plan.moves).toEqual([{ from: 5, to: 3, count: 2 }]);
    expect(plan.endBlock).toBe(5);
    for (const m of plan.moves) expect(m.to).toBeLessThanOrEqual(m.from);
    applyCompaction(state, plan);
    // f1's two extents became one contiguous run.
    expect(f1.extents).toEqual([{ start: 0, count: 5 }]);
    expect(state.free).toEqual([]);
    expect(state.endBlock).toBe(5);
  });

  it('is a no-op for a pack that is already dense', async () => {
    const { planCompaction } = await import('./layout.js');
    const state = newState();
    const a = new BlockAllocator(state);
    const f = file();
    ensureCapacity(f, BLOCK_SIZE * 4, a);
    state.root.children = { f };
    expect(planCompaction(state.root)).toEqual({ moves: [], endBlock: 4 });
  });
});
