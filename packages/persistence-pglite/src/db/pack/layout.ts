/**
 * The on-disk layout of the single-file database store, as pure data and
 * pure functions: nothing here touches the browser. The file system class
 * (opfs-pack.fs.ts) owns the handles and calls into this module to decide
 * WHERE bytes go; this module can therefore be tested without a browser.
 *
 * One pack file holds every Postgres file as a list of extents (runs of
 * fixed-size blocks). A state document — the directory tree with each
 * file's size and extents, plus the free list — describes the pack. The
 * block size matches Postgres's page size, so a page never straddles two
 * extents unless the file was allocated piecemeal, and the free list is
 * kept as coalesced extents so a file that grows keeps growing in place.
 */

export const BLOCK_SIZE = 8192;

export const INITIAL_MODE = {
  DIR: 16384,
  FILE: 32768,
} as const;

/** A run of `count` consecutive blocks starting at block `start`. */
export type Extent = { start: number; count: number };

export interface PackFileNode {
  type: 'file';
  mode: number;
  lastModified: number;
  size: number;
  extents: Extent[];
}

export interface PackDirectoryNode {
  type: 'directory';
  mode: number;
  lastModified: number;
  children: { [name: string]: PackNode };
}

export type PackNode = PackFileNode | PackDirectoryNode;

export interface PackState {
  version: 1;
  /** Monotonic; the higher of the two state slots on disk is the live one. */
  generation: number;
  blockSize: number;
  /** One past the highest block ever handed out; the pack file's length. */
  endBlock: number;
  free: Extent[];
  root: PackDirectoryNode;
}

export function newState(): PackState {
  return {
    version: 1,
    generation: 0,
    blockSize: BLOCK_SIZE,
    endBlock: 0,
    free: [],
    root: {
      type: 'directory',
      mode: INITIAL_MODE.DIR,
      lastModified: Date.now(),
      children: {},
    },
  };
}

/** Parses a state document; null for anything that is not one of ours. */
export function parseState(text: string): PackState | null {
  try {
    const value = JSON.parse(text) as Partial<PackState>;
    if (
      value?.version !== 1 ||
      typeof value.generation !== 'number' ||
      value.blockSize !== BLOCK_SIZE ||
      typeof value.endBlock !== 'number' ||
      !Array.isArray(value.free) ||
      value.root?.type !== 'directory'
    ) {
      return null;
    }
    return value as PackState;
  } catch {
    return null;
  }
}

export const blocksFor = (bytes: number): number =>
  Math.ceil(bytes / BLOCK_SIZE);

export const capacityOf = (node: PackFileNode): number =>
  node.extents.reduce((sum, e) => sum + e.count, 0) * BLOCK_SIZE;

/**
 * Hands out and takes back blocks. Free extents are kept sorted and
 * coalesced; blocks at the very end of the pack are given back to the
 * pack itself (endBlock shrinks) so a shrinking database is not pinned
 * at its high-water mark.
 */
export class BlockAllocator {
  constructor(private readonly state: PackState) {}

  /**
   * Allocates `count` blocks. `after` is the block just past the caller's
   * last extent: if that block is free (or is the end of the pack), the
   * allocation continues there, so a file appended to stays contiguous.
   */
  allocate(count: number, after?: number): Extent[] {
    const out: Extent[] = [];
    let remaining = count;
    const push = (e: Extent) => {
      const last = out[out.length - 1];
      if (last && last.start + last.count === e.start) last.count += e.count;
      else out.push({ ...e });
    };
    if (remaining > 0 && after !== undefined) {
      if (after === this.state.endBlock) {
        push({ start: this.state.endBlock, count: remaining });
        this.state.endBlock += remaining;
        return out;
      }
      const i = this.state.free.findIndex((e) => e.start === after);
      if (i >= 0) {
        const taken = this.takeFrom(i, remaining);
        push(taken);
        remaining -= taken.count;
      }
    }
    // First fit over the free list, then the end of the pack.
    for (let i = 0; remaining > 0 && i < this.state.free.length;) {
      const taken = this.takeFrom(i, remaining);
      push(taken);
      remaining -= taken.count;
      // takeFrom removed the extent when it was consumed whole; otherwise
      // the same index now holds the remainder and we move past it.
      if (this.state.free[i]?.start === taken.start + taken.count) i++;
    }
    if (remaining > 0) {
      push({ start: this.state.endBlock, count: remaining });
      this.state.endBlock += remaining;
    }
    return out;
  }

  /** Returns extents to the free list, coalescing neighbours. */
  release(extents: Extent[]): void {
    const free = this.state.free;
    for (const e of extents) {
      if (e.count <= 0) continue;
      let i = 0;
      while (i < free.length && (free[i]?.start ?? Infinity) < e.start) i++;
      free.splice(i, 0, { ...e });
      const prev = free[i - 1];
      const here = free[i];
      if (prev && here && prev.start + prev.count === here.start) {
        prev.count += here.count;
        free.splice(i, 1);
        i--;
      }
      const cur = free[i];
      const next = free[i + 1];
      if (cur && next && cur.start + cur.count === next.start) {
        cur.count += next.count;
        free.splice(i + 1, 1);
      }
    }
    // Give trailing free space back to the pack.
    const last = free[free.length - 1];
    if (last && last.start + last.count === this.state.endBlock) {
      this.state.endBlock = last.start;
      free.pop();
    }
  }

  private takeFrom(index: number, count: number): Extent {
    const e = this.state.free[index];
    if (!e) throw new Error('takeFrom: no free extent at that index');
    const taken = { start: e.start, count: Math.min(count, e.count) };
    if (taken.count === e.count) this.state.free.splice(index, 1);
    else {
      e.start += taken.count;
      e.count -= taken.count;
    }
    return taken;
  }
}

/** Grows a file's allocation to hold `bytes`; a no-op when it already does. */
export function ensureCapacity(
  node: PackFileNode,
  bytes: number,
  allocator: BlockAllocator
): Extent[] {
  const needed = blocksFor(bytes) - blocksFor(capacityOf(node));
  if (needed <= 0) return [];
  const last = node.extents[node.extents.length - 1];
  const added = allocator.allocate(needed, last && last.start + last.count);
  for (const e of added) {
    const tail = node.extents[node.extents.length - 1];
    if (tail && tail.start + tail.count === e.start) tail.count += e.count;
    else node.extents.push(e);
  }
  return added;
}

/** Shrinks a file's allocation to what `bytes` needs; frees the rest. */
export function shrinkTo(
  node: PackFileNode,
  bytes: number,
  allocator: BlockAllocator
): void {
  let keep = blocksFor(bytes);
  const freed: Extent[] = [];
  const kept: Extent[] = [];
  for (const e of node.extents) {
    if (keep >= e.count) {
      kept.push(e);
      keep -= e.count;
    } else {
      if (keep > 0) kept.push({ start: e.start, count: keep });
      freed.push({ start: e.start + keep, count: e.count - keep });
      keep = 0;
    }
  }
  node.extents = kept;
  allocator.release(freed);
}

/** One contiguous piece of an I/O request, mapped onto the pack file. */
export type Segment = {
  /** Byte offset in the pack file. */
  at: number;
  /** Byte offset within the caller's buffer. */
  offset: number;
  length: number;
};

/**
 * Maps the byte range [position, position + length) of a file onto pack
 * offsets. Only the part inside the file's allocation is returned; a
 * caller reading past it fills the remainder with zeros.
 */
export function planIo(
  node: PackFileNode,
  position: number,
  length: number
): Segment[] {
  const segments: Segment[] = [];
  let fileOffset = 0;
  let done = 0;
  for (const e of node.extents) {
    const extentBytes = e.count * BLOCK_SIZE;
    const extentStart = fileOffset;
    const extentEnd = fileOffset + extentBytes;
    fileOffset = extentEnd;
    const from = Math.max(position + done, extentStart);
    const to = Math.min(position + length, extentEnd);
    if (to <= from) {
      if (extentStart >= position + length) break;
      continue;
    }
    segments.push({
      at: e.start * BLOCK_SIZE + (from - extentStart),
      offset: from - position,
      length: to - from,
    });
    done = to - position;
    if (done >= length) break;
  }
  return segments;
}

/** Walks the tree; throws with an errno-style code when the path is not there. */
export function resolvePath(root: PackDirectoryNode, path: string): PackNode {
  let node: PackNode = root;
  for (const part of pathParts(path)) {
    if (node.type !== 'directory') throw new PackFsError('ENOTDIR');
    const child: PackNode | undefined = node.children[part];
    if (!child) throw new PackFsError('ENOENT');
    node = child;
  }
  return node;
}

export function pathParts(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Every file node under a directory, for freeing a whole subtree. */
export function filesUnder(node: PackNode): PackFileNode[] {
  if (node.type === 'file') return [node];
  return Object.values(node.children).flatMap(filesUnder);
}

export const ERRNO = {
  EBADF: 8,
  EEXIST: 20,
  EINVAL: 28,
  EISDIR: 31,
  ENOENT: 44,
  ENOTDIR: 54,
  ENOTEMPTY: 55,
} as const;

export class PackFsError extends Error {
  readonly code: number;
  constructor(code: keyof typeof ERRNO, message = code) {
    super(message);
    this.name = 'PackFsError';
    this.code = ERRNO[code];
  }
}

/** One run of blocks to copy, lower in the pack. */
export type BlockMove = { from: number; to: number; count: number };

export interface CompactionPlan {
  moves: BlockMove[];
  /** The pack's length in blocks once the moves are done. */
  endBlock: number;
}

/**
 * Plans packing every live extent to the front of the pack, in the order
 * the extents sit on disk. Because destinations are handed out in that
 * same ascending order, every move goes DOWN (`to <= from`): copying the
 * moves in the returned order never overwrites a block that has not been
 * copied yet, so the copy needs no scratch space. Applying the plan
 * rewrites each file's extents in place (`applyCompaction`); the free
 * list empties and trailing space is returned.
 */
export function planCompaction(root: PackDirectoryNode): CompactionPlan {
  const placed: Extent[] = [];
  for (const node of filesUnder(root)) placed.push(...node.extents);
  placed.sort((a, b) => a.start - b.start);
  const moves: BlockMove[] = [];
  let cursor = 0;
  for (const extent of placed) {
    if (extent.start !== cursor) {
      moves.push({ from: extent.start, to: cursor, count: extent.count });
    }
    cursor += extent.count;
  }
  return { moves, endBlock: cursor };
}

/** Rewrites the tree and the free list to match a plan whose moves are done. */
export function applyCompaction(state: PackState, plan: CompactionPlan): void {
  const byFrom = new Map(plan.moves.map((m) => [m.from, m.to]));
  for (const node of filesUnder(state.root)) {
    const moved = node.extents.map((e) => ({
      start: byFrom.get(e.start) ?? e.start,
      count: e.count,
    }));
    const merged: Extent[] = [];
    for (const e of moved) {
      const last = merged[merged.length - 1];
      if (last && last.start + last.count === e.start) last.count += e.count;
      else merged.push(e);
    }
    node.extents = merged;
  }
  state.free = [];
  state.endBlock = plan.endBlock;
}
