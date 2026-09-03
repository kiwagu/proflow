import type { Result } from 'neverthrow';

/**
 * What the browser is holding for this app, in bytes.
 *
 * `used` and `quota` are the browser's own numbers for the whole origin —
 * database, files and everything else together — and either can be absent,
 * since a browser is allowed to decline the question. The rest is what the
 * app knows about its own storage, which is the part a user can act on.
 */
export interface StorageReport {
  used: number | null;
  quota: number | null;
  /** Stored bytes of files that are still listed somewhere. */
  files: number;
  /** Bytes taken by unpacked archives — rebuildable from the archives. */
  unpacked: number;
  /** Bytes the database file occupies on the device. */
  database: number;
  /**
   * Bytes nothing references any more: freeing them loses nothing. Counts
   * the database's own slack too — space rows once used and left behind.
   */
  reclaimable: number;
}

/**
 * Port: looking after the space this app occupies on the device.
 *
 * Local-first means there is no server copy to fall back on, so the two
 * things a user may want here are of very different weights and are kept
 * apart: reclaiming what nothing needs, and deliberately starting over.
 */
export interface IStorageMaintenance {
  report(): Promise<Result<StorageReport, string>>;
  /**
   * Frees what nothing references — deleted files' bytes, and anything the
   * store kept that the database no longer names. Resolves to the bytes
   * freed. Nothing a user can still see is touched.
   */
  freeUnused(): Promise<Result<number, string>>;
  /**
   * Deletes everything this app has stored on the device: documents,
   * files, chats, settings, the database itself. There is no copy
   * elsewhere — the caller must have asked first.
   */
  deleteEverything(): Promise<Result<void, string>>;
}
