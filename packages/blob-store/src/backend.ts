import type { BlobInfo } from '@workspace/domain';

/** What a storage backend must provide; identity (hashing) is done above it. */
export interface BlobBackend {
  readonly name: 'opfs' | 'idb';
  write(
    hash: string,
    blob: Blob,
    onProgress?: (done: number) => void
  ): Promise<void>;
  read(hash: string): Promise<Blob | null>;
  size(hash: string): Promise<number | null>;
  remove(hash: string): Promise<void>;
  /**
   * Package area: one unpacked file per (hash, normalized path). Bytes
   * arrive whole for small entries and as a stream for large ones — a
   * stream pair per file costs more than a small file does, and a package
   * is mostly small files.
   */
  writeEntry(
    hash: string,
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array
  ): Promise<number>;
  readEntry(hash: string, path: string): Promise<Blob | null>;
  removePackage(hash: string): Promise<void>;
  /** Stored bytes, hash by hash — the store's half of "what is unused". */
  list(): Promise<Array<{ hash: string; size: number }>>;
  /** Unpacked archives and what each area takes. */
  listPackages(): Promise<Array<{ hash: string; size: number }>>;
  /** Everything the backend holds, both areas. */
  clear(): Promise<void>;
}

export function infoOf(hash: string, blob: Blob): BlobInfo {
  return {
    hash,
    size: blob.size,
    mime: blob.type || 'application/octet-stream',
  };
}
