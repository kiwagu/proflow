import {
  type IPackageStore,
  mimeOf,
  type PackageEntry,
} from '@workspace/domain';
import {
  BlobReader,
  configure,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js';
import type { BlobBackend } from './backend.js';
import { confinePath } from './path.js';

// Already inside a worker: a pool of further workers would only add hops.
configure({ useWebWorkers: false });

/**
 * Entries this size or smaller are inflated whole and written in one call.
 * A TransformStream pair per file costs more than a small file does, and a
 * package is mostly small files.
 */
const WHOLE_ENTRY_LIMIT = 4 * 1024 * 1024;

/** Entries decompressed concurrently: enough to keep the file system busy. */
const CONCURRENCY = 32;

/**
 * Unpacks archives into the backend's package area, entry by entry and
 * streamed: the archive is read by its central directory, each entry is
 * inflated straight into its file. Entry names are confined the same way
 * reads are, so an archive cannot write outside its own area either.
 */
export function createPackageStoreOver(backend: BlobBackend): IPackageStore {
  const locks = globalThis.navigator?.locks;
  const exclusive = <T>(hash: string, fn: () => Promise<T>) =>
    locks ? locks.request(`workbench-pkg:${hash}`, fn) : fn();

  return {
    list: () => backend.listPackages(),
    unpack(hash, archive, onProgress) {
      return exclusive(hash, async () => {
        const reader = new ZipReader(new BlobReader(archive));
        const entries: PackageEntry[] = [];
        try {
          const files = (await reader.getEntries()).flatMap((entry) => {
            if (entry.directory) return [];
            const path = confinePath(entry.filename);
            // A name that cannot be confined to the package is dropped —
            // an archive must not write outside its own area either.
            return path ? [{ entry, path }] : [];
          });
          onProgress?.(0, files.length);
          // Decompression is native and asynchronous; running a window of
          // entries at once keeps it and the file system overlapped.
          for (let start = 0; start < files.length; start += CONCURRENCY) {
            const batch = files.slice(start, start + CONCURRENCY);
            const written = await Promise.all(
              batch.map(async ({ entry, path }) => {
                const small =
                  (entry.uncompressedSize ?? 0) <= WHOLE_ENTRY_LIMIT;
                if (small) {
                  const bytes = await entry.getData?.(new Uint8ArrayWriter());
                  const data = bytes ?? new Uint8Array();
                  const size = await backend.writeEntry(hash, path, data);
                  return { path, size, mime: mimeOf(path) };
                }
                const { readable, writable } =
                  new TransformStream<Uint8Array>();
                const [, size] = await Promise.all([
                  entry.getData?.(writable),
                  backend.writeEntry(hash, path, readable),
                ]);
                return { path, size, mime: mimeOf(path) };
              })
            );
            entries.push(...written);
            onProgress?.(entries.length, files.length);
          }
        } finally {
          await reader.close();
        }
        return entries;
      });
    },
    async inspect(archive) {
      const reader = new ZipReader(new BlobReader(archive));
      try {
        return (await reader.getEntries()).flatMap((entry) => {
          if (entry.directory) return [];
          const path = confinePath(entry.filename);
          return path
            ? [
                {
                  path,
                  size: entry.uncompressedSize ?? 0,
                  mime: mimeOf(path),
                },
              ]
            : [];
        });
      } finally {
        await reader.close();
      }
    },

    async readEntry(hash, path) {
      const safe = confinePath(path);
      if (!safe) return null;
      const file = await backend.readEntry(hash, safe);
      if (!file) return null;
      // OPFS files carry no MIME type; consumers (data: URLs, stylesheet
      // detection) need one. Wrapping in a File does not copy the bytes.
      return new File([file], safe.split('/').pop() ?? safe, {
        type: mimeOf(safe),
      });
    },
    remove: (hash) => exclusive(hash, () => backend.removePackage(hash)),
  };
}
