import type { Result } from 'neverthrow';
import type {
  PackageAuditEvent,
  PackageEntry,
  PackageInfo,
  PackagePreview,
} from './package.do.js';
import type { UnpackProgress } from './package.store.js';

/**
 * Port: packages — unpacked archives with an index and per-context state.
 *
 * Importing unpacks the archive's bytes (already in the blob store) into a
 * package area and records the index; reading an entry goes through the
 * same path check every time, because the caller is untrusted content.
 */
export interface IPackageRepository {
  /**
   * Unpacks the archive stored as `hash`, detects its kind, indexes it.
   * Returns the existing package when it is already unpacked, so callers
   * can simply ask for a package and get one.
   */
  importArchive(
    hash: string,
    onProgress?: UnpackProgress
  ): Promise<Result<PackageInfo, string>>;
  get(hash: string): Promise<Result<PackageInfo | null, string>>;
  /**
   * Throws away what unpacking produced — the unpacked files and the index
   * — and keeps the archive itself.
   *
   * Unpacking is a cache: every byte of it can be produced again from the
   * archive, which is the copy worth keeping. A package of a few thousand
   * files is also the largest thing this app writes to disk, so being able
   * to reclaim that space without losing the file is what makes unpacking
   * safe to do freely.
   */
  discardUnpacked(hash: string): Promise<Result<void, string>>;
  /** What the archive holds, read from its index without unpacking it. */
  preview(hash: string): Promise<Result<PackagePreview, string>>;
  entries(hash: string): Promise<Result<PackageEntry[], string>>;
  /**
   * The bytes of one entry, or null when the package has no such entry.
   * `path` is normalized and confined to the package; an attempt to reach
   * outside is refused and recorded.
   */
  readEntry(hash: string, path: string): Promise<Result<Blob | null, string>>;
  /** Per-context runtime state (a course's progress, for one); `context` is a document id or ''. */
  getState(
    hash: string,
    context: string
  ): Promise<Result<Record<string, unknown>, string>>;
  setState(
    hash: string,
    context: string,
    state: Record<string, unknown>
  ): Promise<Result<void, string>>;
  audit(hash: string, event: PackageAuditEvent): Promise<void>;
}
