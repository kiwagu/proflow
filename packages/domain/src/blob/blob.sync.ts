import type { BlobInfo } from './blob.store.js';

/**
 * Whether the durable copy of some bytes is known to exist.
 *
 * Only two states exist on purpose. There is no 'uploading': every step of a
 * transfer is idempotent under content addressing, so a crash mid-flight is
 * indistinguishable from never having started — re-running is always correct,
 * and a third state would only be something to get stuck in.
 */
export type BlobSyncState = 'local' | 'synced';

/** A blob the local side holds and the durable side may or may not. */
export interface BlobSyncRecord extends BlobInfo {
  syncState: BlobSyncState;
}

/**
 * Port: the local half of media sync — the metadata the device keeps about
 * its own content-addressed bytes. Bytes themselves go through IBlobStore;
 * this is only the bookkeeping that decides what still has to travel.
 */
export interface IBlobSyncLocal {
  /** Blobs with no confirmed durable copy, oldest first. */
  pending(limit: number): Promise<BlobSyncRecord[]>;
  /** Records that a durable copy is confirmed. Idempotent. */
  markSynced(hash: string): Promise<void>;
  /**
   * Registers a blob that arrived from the durable side, already synced.
   * Idempotent by hash — the same content re-pulled changes nothing.
   */
  registerSynced(info: BlobInfo): Promise<void>;
  /** The record for one hash, or null when the device knows nothing about it. */
  find(hash: string): Promise<BlobSyncRecord | null>;
}

/**
 * Port: the durable half — an object store keyed by the same content hash the
 * local store uses, plus the metadata row that certifies an object complete.
 *
 * The split between `putObject` and `certify` is load-bearing, not an
 * implementation detail: bytes land first, the certificate second, so a row's
 * existence always means the object behind it is whole. Reversing the order
 * would make a crash leave a promise with nothing behind it.
 */
export interface IBlobSyncRemote {
  /** Whether a certificate exists — i.e. another device already pushed this. */
  isCertified(hash: string): Promise<boolean>;
  /** Uploads the bytes. Must be safe to repeat: the key is the content. */
  putObject(hash: string, blob: Blob): Promise<void>;
  /** Writes the certificate. Called only after `putObject` resolved. */
  certify(info: BlobInfo): Promise<void>;
  /**
   * Fetches durable bytes for a hash, or null when nothing is certified.
   * The caller verifies the content structurally, so the transport does not
   * have to be trusted.
   */
  fetchObject(hash: string): Promise<Blob | null>;
}
