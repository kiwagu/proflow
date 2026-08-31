import { BaseFilesystem, type FsStats } from '@electric-sql/pglite/basefs';
import {
  applyCompaction,
  BLOCK_SIZE,
  BlockAllocator,
  ensureCapacity,
  filesUnder,
  INITIAL_MODE,
  newState,
  type PackDirectoryNode,
  type PackFileNode,
  PackFsError,
  type PackState,
  parseState,
  pathParts,
  planCompaction,
  planIo,
  resolvePath,
  shrinkTo,
} from './layout.js';

/**
 * A PGlite file system that keeps the whole database in ONE OPFS file.
 *
 * PGlite's own OPFS file system gives every Postgres file its own OPFS
 * file and keeps a sync access handle open on each — around 1,160 handles
 * for a database that has barely been used, since a fresh Postgres data
 * directory alone has ~1,060 files. Each open handle costs the browser a
 * file descriptor, and some browsers cap a tab at 1,024 of them (Ubuntu's
 * Chromium snap), others at 252 (Safari): there, the database can never
 * open, and the tab freezes on the attempt.
 *
 * Here the Postgres files are extents inside a single pack file, and the
 * directory tree, sizes and free list live in a small state document. Three
 * handles in total: the pack and two alternating state slots.
 *
 * Durability: `syncToFs` runs after every query. It flushes the pack, then
 * writes the state into the slot that is NOT current (so a crash mid-write
 * leaves the previous generation intact) and flushes that. The higher
 * generation wins on open. Writes between two syncs are not durable —
 * the same window Postgres itself accepts between fsyncs, and the same one
 * PGlite's other file systems have.
 *
 * Adapted from the shape of PGlite's OpfsAhpFS (Apache-2.0).
 */
export class OpfsPackFS extends BaseFilesystem {
  declare readonly dataDir: string;

  #dir!: FileSystemDirectoryHandle;
  #pack!: SyncAccessHandle;
  #slots!: [SyncAccessHandle, SyncAccessHandle];
  #current = 0;

  state!: PackState;
  #allocator!: BlockAllocator;
  #dirty = false;

  #nextFd = 0;
  #fdPaths = new Map<number, string>();

  constructor(dataDir: string, options: { debug?: boolean } = {}) {
    super(dataDir, options);
  }

  async init(
    pg: Parameters<BaseFilesystem['init']>[0],
    opts: Parameters<BaseFilesystem['init']>[1]
  ): ReturnType<BaseFilesystem['init']> {
    await this.#open();
    return super.init(pg, opts);
  }

  async syncToFs(relaxedDurability = false) {
    if (!this.#dirty) return;
    if (this.#shouldCompact()) this.compact();
    if (!relaxedDurability) this.#pack.flush();
    this.#writeState(!relaxedDurability);
    this.#dirty = false;
  }

  /**
   * Packs every live extent to the front of the file and gives the rest
   * back to the disk. Blocks a file no longer uses stay inside the pack
   * otherwise — reused by later writes, but never returned — so a database
   * that shrank keeps its high-water mark until this runs. Runs between
   * queries (the caller holds the database's exclusive lock); the copy is
   * one pass of synchronous reads and writes, ~1 s per 100 MB.
   */
  compact(): { before: number; after: number } {
    const before = this.packBytes;
    const plan = planCompaction(this.state.root);
    if (plan.moves.length === 0 && plan.endBlock === this.state.endBlock) {
      return { before, after: before };
    }
    const buffer = new Uint8Array(COPY_CHUNK_BLOCKS * BLOCK_SIZE);
    for (const move of plan.moves) {
      // Moves only ever go down and come in ascending order, so a chunk
      // copied here never lands on a block still waiting to be read.
      for (let done = 0; done < move.count; done += COPY_CHUNK_BLOCKS) {
        const blocks = Math.min(COPY_CHUNK_BLOCKS, move.count - done);
        const chunk = buffer.subarray(0, blocks * BLOCK_SIZE);
        this.#pack.read(chunk, { at: (move.from + done) * BLOCK_SIZE });
        this.#pack.write(chunk, { at: (move.to + done) * BLOCK_SIZE });
      }
    }
    applyCompaction(this.state, plan);
    this.#pack.truncate(this.state.endBlock * BLOCK_SIZE);
    this.#pack.flush();
    this.#writeState(true);
    this.#dirty = false;
    return { before, after: this.packBytes };
  }

  /** Enough is free, and enough of the pack is free, to be worth a pass. */
  #shouldCompact(): boolean {
    const free = this.freeBytes;
    return (
      free >= AUTO_COMPACT_MIN_FREE_BYTES &&
      free >= this.packBytes * AUTO_COMPACT_MIN_FREE_RATIO
    );
  }

  async closeFs(): Promise<void> {
    await this.syncToFs();
    this.#pack.close();
    for (const slot of this.#slots) slot.close();
    this.pg?.Module.FS.quit();
  }

  async #open() {
    const root = await navigator.storage.getDirectory();
    let dir = root;
    for (const part of pathParts(this.dataDir)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    this.#dir = dir;
    const handle = async (name: string): Promise<SyncAccessHandle> =>
      (
        (await dir.getFileHandle(name, {
          create: true,
        })) as FileSystemFileHandle & {
          createSyncAccessHandle(): Promise<SyncAccessHandle>;
        }
      ).createSyncAccessHandle();
    this.#pack = await handle(PACK_FILE);
    this.#slots = [await handle(STATE_SLOTS[0]), await handle(STATE_SLOTS[1])];

    const a = parseState(readAll(this.#slots[0]));
    const b = parseState(readAll(this.#slots[1]));
    this.#current = (b?.generation ?? -1) > (a?.generation ?? -1) ? 1 : 0;
    const found = this.#current === 1 ? b : a;
    this.state = found ?? newState();
    this.#allocator = new BlockAllocator(this.state);
    if (!found) {
      // Brand new: write generation 0 so a crash before the first sync
      // still leaves a readable, empty store rather than two blank slots.
      this.#writeState(true);
    }
  }

  #writeState(flush: boolean) {
    this.state.generation += 1;
    const target = 1 - this.#current;
    const slot = this.#slots[target === 1 ? 1 : 0];
    const bytes = new TextEncoder().encode(JSON.stringify(this.state));
    slot.write(bytes, { at: 0 });
    slot.truncate(bytes.byteLength);
    if (flush) slot.flush();
    this.#current = target;
  }

  // Filesystem API — the shape PGlite's Emscripten adapter expects.

  chmod(path: string, mode: number): void {
    resolvePath(this.state.root, path).mode = mode;
    this.#dirty = true;
  }

  close(fd: number): void {
    this.#fdPaths.delete(fd);
  }

  fstat(fd: number): FsStats {
    return this.lstat(this.#pathOf(fd));
  }

  lstat(path: string): FsStats {
    const node = resolvePath(this.state.root, path);
    const size = node.type === 'file' ? node.size : 0;
    return {
      dev: 0,
      ino: 0,
      mode: node.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      blksize: BLOCK_SIZE,
      blocks: Math.ceil(size / BLOCK_SIZE),
      atime: node.lastModified,
      mtime: node.lastModified,
      ctime: node.lastModified,
    };
  }

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void {
    const parts = pathParts(path);
    const name = parts.pop();
    if (name === undefined) throw new PackFsError('EEXIST');
    let node = this.state.root;
    const walked: string[] = [];
    for (const part of parts) {
      walked.push(part);
      if (!Object.hasOwn(node.children, part)) {
        if (!options?.recursive) throw new PackFsError('ENOENT');
        this.mkdir(walked.join('/'), options);
      }
      const child = node.children[part];
      if (child?.type !== 'directory') throw new PackFsError('ENOTDIR');
      node = child;
    }
    if (Object.hasOwn(node.children, name)) throw new PackFsError('EEXIST');
    node.children[name] = {
      type: 'directory',
      mode: options?.mode || INITIAL_MODE.DIR,
      lastModified: Date.now(),
      children: {},
    };
    this.#dirty = true;
  }

  open(path: string): number {
    const node = resolvePath(this.state.root, path);
    if (node.type !== 'file') throw new PackFsError('EISDIR');
    const fd = ++this.#nextFd;
    this.#fdPaths.set(fd, path);
    return fd;
  }

  readdir(path: string): string[] {
    const node = resolvePath(this.state.root, path);
    if (node.type !== 'directory') throw new PackFsError('ENOTDIR');
    return Object.keys(node.children);
  }

  read(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): number {
    const node = this.#fileOf(fd);
    if (position >= node.size) return 0;
    const wanted = Math.min(length, node.size - position);
    // The adapter hands us the module heap with an absolute offset into it.
    const target = new Uint8Array(buffer.buffer, offset, wanted);
    let filled = 0;
    for (const s of planIo(node, position, wanted)) {
      const view = new Uint8Array(buffer.buffer, offset + s.offset, s.length);
      const got = this.#pack.read(view, { at: s.at });
      if (got < s.length) view.fill(0, got);
      filled = s.offset + s.length;
    }
    if (filled < wanted) target.fill(0, filled);
    return wanted;
  }

  rename(oldPath: string, newPath: string): void {
    const [oldParent, oldName] = this.#parentOf(oldPath);
    const [newParent, newName] = this.#parentOf(newPath);
    const moved = oldParent.children[oldName];
    if (!moved) throw new PackFsError('ENOENT');
    const replaced = newParent.children[newName];
    if (replaced) this.#free(replaced);
    newParent.children[newName] = moved;
    delete oldParent.children[oldName];
    this.#dirty = true;
  }

  rmdir(path: string): void {
    const [parent, name] = this.#parentOf(path);
    const node = parent.children[name];
    if (!node) throw new PackFsError('ENOENT');
    if (node.type !== 'directory') throw new PackFsError('ENOTDIR');
    if (Object.keys(node.children).length > 0) {
      throw new PackFsError('ENOTEMPTY');
    }
    delete parent.children[name];
    this.#dirty = true;
  }

  truncate(path: string, len = 0): void {
    const node = resolvePath(this.state.root, path);
    if (node.type !== 'file') throw new PackFsError('EISDIR');
    if (len < node.size) {
      shrinkTo(node, len, this.#allocator);
    } else if (len > node.size) {
      // Growing by truncation must read back as zeros, and a reused block
      // still holds whatever it held before.
      this.#zeroFill(node, node.size, len - node.size);
    }
    node.size = len;
    node.lastModified = Date.now();
    this.#dirty = true;
  }

  unlink(path: string): void {
    const [parent, name] = this.#parentOf(path);
    const node = parent.children[name];
    if (!node) throw new PackFsError('ENOENT');
    if (node.type !== 'file') throw new PackFsError('EISDIR');
    delete parent.children[name];
    this.#free(node);
    for (const [fd, p] of this.#fdPaths)
      if (p === path) this.#fdPaths.delete(fd);
    this.#dirty = true;
  }

  utimes(path: string, _atime: number, mtime: number): void {
    resolvePath(this.state.root, path).lastModified = mtime;
    this.#dirty = true;
  }

  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string; mode?: number; flag?: string }
  ): void {
    const [parent, name] = this.#parentOf(path);
    let node = parent.children[name];
    if (!node) {
      node = {
        type: 'file',
        mode: options?.mode || INITIAL_MODE.FILE,
        lastModified: Date.now(),
        size: 0,
        extents: [],
      };
      parent.children[name] = node;
    } else if (node.type !== 'file') {
      throw new PackFsError('EISDIR');
    }
    node.lastModified = Date.now();
    this.#dirty = true;
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (bytes.byteLength > 0) this.#writeAt(node, bytes, 0);
  }

  write(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): number {
    const node = this.#fileOf(fd);
    // The adapter passes the heap's ArrayBuffer here, typed as Uint8Array.
    const source = new Uint8Array(
      buffer as unknown as ArrayBuffer,
      offset,
      length
    );
    this.#writeAt(node, source, position);
    return length;
  }

  // Internals

  #writeAt(node: PackFileNode, bytes: Uint8Array, position: number) {
    ensureCapacity(node, position + bytes.byteLength, this.#allocator);
    for (const s of planIo(node, position, bytes.byteLength)) {
      this.#pack.write(bytes.subarray(s.offset, s.offset + s.length), {
        at: s.at,
      });
    }
    node.size = Math.max(node.size, position + bytes.byteLength);
    node.lastModified = Date.now();
    this.#dirty = true;
  }

  #zeroFill(node: PackFileNode, position: number, length: number) {
    ensureCapacity(node, position + length, this.#allocator);
    const zeros = new Uint8Array(Math.min(length, BLOCK_SIZE * 16));
    for (const s of planIo(node, position, length)) {
      for (let done = 0; done < s.length; done += zeros.byteLength) {
        const chunk = Math.min(zeros.byteLength, s.length - done);
        this.#pack.write(zeros.subarray(0, chunk), { at: s.at + done });
      }
    }
  }

  #free(node: PackDirectoryNode | PackFileNode) {
    for (const file of filesUnder(node)) {
      this.#allocator.release(file.extents);
      file.extents = [];
      file.size = 0;
    }
  }

  #parentOf(path: string): [PackDirectoryNode, string] {
    const parts = pathParts(path);
    const name = parts.pop();
    if (name === undefined) throw new PackFsError('EINVAL');
    const parent = resolvePath(this.state.root, parts.join('/'));
    if (parent.type !== 'directory') throw new PackFsError('ENOTDIR');
    return [parent, name];
  }

  #pathOf(fd: number): string {
    const path = this.#fdPaths.get(fd);
    if (path === undefined) throw new PackFsError('EBADF');
    return path;
  }

  #fileOf(fd: number): PackFileNode {
    const node = resolvePath(this.state.root, this.#pathOf(fd));
    if (node.type !== 'file') throw new PackFsError('EISDIR');
    return node;
  }

  /** Bytes the pack file occupies on disk, for storage reporting. */
  get packBytes(): number {
    return this.state.endBlock * BLOCK_SIZE;
  }

  /** Bytes of that which no file uses any more. */
  get freeBytes(): number {
    return this.state.free.reduce((n, e) => n + e.count, 0) * BLOCK_SIZE;
  }

  get directoryHandle(): FileSystemDirectoryHandle {
    return this.#dir;
  }
}

/** The DOM lib does not type sync access handles; this is the part used. */
interface SyncAccessHandle {
  close(): void;
  flush(): void;
  getSize(): number;
  read(buffer: ArrayBuffer | ArrayBufferView, options: { at: number }): number;
  truncate(newSize: number): void;
  write(buffer: ArrayBuffer | ArrayBufferView, options: { at: number }): number;
}

const PACK_FILE = 'pack.bin';
const COPY_CHUNK_BLOCKS = 128; // 1 MiB per read/write pair
/**
 * Automatic compaction runs after a query once this much of the pack is
 * free — both an absolute floor, so a small database is never churned for
 * a few megabytes, and a share, so a large one is not repacked for a
 * fraction of itself. The settings page can always ask for one outright.
 */
const AUTO_COMPACT_MIN_FREE_BYTES = 64 * 1024 * 1024;
const AUTO_COMPACT_MIN_FREE_RATIO = 0.3;
const STATE_SLOTS = ['pack-state.a.json', 'pack-state.b.json'] as const;

function readAll(handle: SyncAccessHandle): string {
  const buffer = new ArrayBuffer(handle.getSize());
  handle.read(buffer, { at: 0 });
  return new TextDecoder().decode(buffer);
}
