import type { PackageEntry } from './package.do.js';

export type UnpackProgress = (done: number, total: number) => void;

/**
 * Port: the unpacked bytes of packages, keyed by archive hash and path.
 *
 * Sits beside the blob store (same worker, same file system) and knows
 * nothing about kinds or manifests — only how to unpack an archive into
 * its area and hand back one file from it.
 */
export interface IPackageStore {
  /**
   * Unpacks `archive` under `hash`; resolves to the entries written.
   * Idempotent. `onProgress` reports entries done out of the total.
   */
  unpack(
    hash: string,
    archive: Blob,
    onProgress?: UnpackProgress
  ): Promise<PackageEntry[]>;
  /**
   * Lists what an archive holds WITHOUT unpacking it: a zip's index sits
   * at its end, so this costs a read of that index, not of the content.
   */
  inspect(archive: Blob): Promise<PackageEntry[]>;
  /** One unpacked file, or null. `path` must already be normalized. */
  readEntry(hash: string, path: string): Promise<Blob | null>;
  remove(hash: string): Promise<void>;
  /** Archive hashes with an unpacked area here, and what each one takes. */
  list(): Promise<Array<{ hash: string; size: number }>>;
}
