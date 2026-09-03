import type { BlobInfo, PackageEntry } from '@workspace/domain';

/** Request/response frames between the store client and its worker. */
export type BlobCommand =
  | { op: 'put'; blob: Blob }
  | { op: 'get'; hash: string }
  | { op: 'has'; hash: string }
  | { op: 'delete'; hash: string }
  | { op: 'unpack'; hash: string; archive: Blob }
  | { op: 'inspect'; archive: Blob }
  | { op: 'readEntry'; hash: string; path: string }
  | { op: 'removePackage'; hash: string }
  | { op: 'list' }
  | { op: 'listPackages' }
  | { op: 'clear' };

export type BlobRequest = BlobCommand & { id: number };

export type BlobResponse =
  | {
      id: number;
      ok: true;
      result:
        | BlobInfo
        | Blob
        | boolean
        | null
        | PackageEntry[]
        | Array<{ hash: string; size: number }>;
    }
  | { id: number; ok: false; error: string };

export type BlobReady = {
  type: 'ready';
  backend: 'opfs' | 'idb';
  /** Whether the origin's storage is protected from eviction. */
  persisted: boolean;
};

/** Emitted during a `put` or an `unpack`, before its response. */
export type BlobProgressEvent = {
  type: 'progress';
  id: number;
  done: number;
  total: number;
};
