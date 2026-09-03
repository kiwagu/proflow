import type { BlobBackend } from './backend.js';

/**
 * Sync access handles exist only in dedicated workers and are missing from
 * the DOM lib, so the slice used here is declared locally.
 */
interface SyncAccessHandle {
  write(
    buffer: ArrayBufferView<ArrayBufferLike>,
    options?: { at?: number }
  ): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
type OpfsFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
};

const DIR = 'blobs';
const PKG_DIR = 'pkg';
const CHUNK = 4 * 1024 * 1024;

/**
 * Origin Private File System backend. Files are written through a sync
 * access handle in fixed chunks and flushed before the write is reported
 * done — a local-first store must not say "saved" before the bytes are.
 */
export async function createOpfsBackend(): Promise<BlobBackend | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
    return null;
  let dir: FileSystemDirectoryHandle;
  let pkgRoot: FileSystemDirectoryHandle;
  try {
    const root = await navigator.storage.getDirectory();
    dir = await root.getDirectoryHandle(DIR, { create: true });
    pkgRoot = await root.getDirectoryHandle(PKG_DIR, { create: true });
    // Probe for sync handles (absent on main threads and old Safari).
    const probe = (await dir.getFileHandle('.probe', {
      create: true,
    })) as OpfsFileHandle;
    if (typeof probe.createSyncAccessHandle !== 'function') return null;
    const h = await probe.createSyncAccessHandle();
    h.close();
  } catch {
    return null;
  }

  async function fileOf(hash: string, create = false) {
    try {
      return (await dir.getFileHandle(hash, { create })) as OpfsFileHandle;
    } catch {
      return null;
    }
  }

  // Directory handles are resolved once per directory, not once per file:
  // unpacking walks the same folders hundreds of times, and each hop is a
  // round-trip into the file system.
  const dirCache = new Map<string, Promise<FileSystemDirectoryHandle | null>>();

  function dirHandle(
    hash: string,
    dirPath: string,
    create: boolean
  ): Promise<FileSystemDirectoryHandle | null> {
    const key = `${create ? 'w' : 'r'}:${hash}/${dirPath}`;
    let cached = dirCache.get(key);
    if (!cached) {
      cached = (async () => {
        try {
          let cur = await pkgRoot.getDirectoryHandle(hash, { create });
          for (const seg of dirPath.split('/').filter(Boolean)) {
            cur = await cur.getDirectoryHandle(seg, { create });
          }
          return cur;
        } catch {
          return null;
        }
      })();
      dirCache.set(key, cached);
    }
    return cached;
  }

  /** Walks `hash/a/b` under the package root, creating on the way when asked. */
  async function entryHandle(hash: string, path: string, create: boolean) {
    const cut = path.lastIndexOf('/');
    const dir = await dirHandle(
      hash,
      cut < 0 ? '' : path.slice(0, cut),
      create
    );
    if (!dir) return null;
    try {
      return (await dir.getFileHandle(path.slice(cut + 1), {
        create,
      })) as OpfsFileHandle;
    } catch {
      return null;
    }
  }

  return {
    name: 'opfs',
    async writeEntry(hash, path, data) {
      const handle = await entryHandle(hash, path, true);
      if (!handle) throw new Error(`opfs: cannot create ${path}`);
      const access = await handle.createSyncAccessHandle();
      let at = 0;
      try {
        if (data instanceof Uint8Array) {
          access.write(data, { at: 0 });
          at = data.byteLength;
        } else {
          const reader = data.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            access.write(value, { at });
            at += value.byteLength;
          }
        }
        access.truncate(at);
        // No flush here, unlike a blob: an unpacked entry is a cache that
        // can be rebuilt from the archive, which IS stored durably. Paying
        // an fsync per file would double the cost of unpacking a package.
      } finally {
        access.close();
      }
      return at;
    },
    async readEntry(hash, path) {
      const handle = await entryHandle(hash, path, false);
      return handle ? handle.getFile() : null;
    },
    async removePackage(hash) {
      for (const key of [...dirCache.keys()]) {
        if (key.slice(2).startsWith(`${hash}/`)) dirCache.delete(key);
      }
      try {
        await pkgRoot.removeEntry(hash, { recursive: true });
      } catch {
        // Already gone.
      }
    },
    async write(hash, blob, onProgress) {
      const handle = await fileOf(hash, true);
      if (!handle) throw new Error('opfs: cannot create file');
      const access = await handle.createSyncAccessHandle();
      try {
        let at = 0;
        while (at < blob.size) {
          const chunk = new Uint8Array(
            await blob.slice(at, at + CHUNK).arrayBuffer()
          );
          access.write(chunk, { at });
          at += chunk.byteLength;
          onProgress?.(at);
        }
        access.flush();
      } finally {
        access.close();
      }
    },
    async read(hash) {
      const handle = await fileOf(hash);
      return handle ? handle.getFile() : null;
    },
    async size(hash) {
      const handle = await fileOf(hash);
      return handle ? (await handle.getFile()).size : null;
    },
    async remove(hash) {
      try {
        await dir.removeEntry(hash);
      } catch {
        // Already gone.
      }
    },
    async list() {
      const out: Array<{ hash: string; size: number }> = [];
      for await (const [name, handle] of entriesOf(dir)) {
        // The probe file the backend writes to test for sync handles.
        if (name.startsWith('.') || handle.kind !== 'file') continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ hash: name, size: file.size });
      }
      return out;
    },
    async listPackages() {
      const out: Array<{ hash: string; size: number }> = [];
      for await (const [name, handle] of entriesOf(pkgRoot)) {
        if (handle.kind !== 'directory') continue;
        out.push({
          hash: name,
          size: await sizeOfTree(handle as FileSystemDirectoryHandle),
        });
      }
      return out;
    },
    async clear() {
      dirCache.clear();
      for (const [root, names] of [
        [dir, await namesOf(dir)],
        [pkgRoot, await namesOf(pkgRoot)],
      ] as const) {
        for (const name of names) {
          await root.removeEntry(name, { recursive: true }).catch(() => {});
        }
      }
    },
  };
}

/**
 * Directory iteration, declared locally: the file-system access types in
 * the DOM lib do not carry the async iterator every implementation has.
 */
type IterableDirectory = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

function entriesOf(
  dir: FileSystemDirectoryHandle
): AsyncIterableIterator<[string, FileSystemHandle]> {
  return (dir as IterableDirectory).entries();
}

async function namesOf(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name] of entriesOf(dir)) names.push(name);
  return names;
}

async function sizeOfTree(dir: FileSystemDirectoryHandle): Promise<number> {
  let total = 0;
  for await (const [, handle] of entriesOf(dir)) {
    total +=
      handle.kind === 'file'
        ? (await (handle as FileSystemFileHandle).getFile()).size
        : await sizeOfTree(handle as FileSystemDirectoryHandle);
  }
  return total;
}
