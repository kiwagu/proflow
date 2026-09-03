import { createStore } from '../../reactive/store';

/**
 * Where the editor's attachments come from and go to.
 *
 * The editor lives in a library layer that must not know the blob store
 * or the file tree; the composition root installs an implementation here,
 * the same way it installs the AI edit runner. Until it does, attachment
 * commands are no-ops.
 */
export interface AttachmentStore {
  /** Stores the file's bytes (and lists it in the explorer); resolves to its identity. */
  importFile(
    file: File,
    onProgress?: (done: number, total: number) => void
  ): Promise<{
    hash: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
  /** An object URL for stored bytes, or null when unknown. Cached per hash. */
  resolveUrl(hash: string): Promise<string | null>;
  /** Opens the explorer's entry for these bytes, when there is one. */
  open?(hash: string): Promise<void>;
  /** Tells the user an attachment failed; installed by the app shell. */
  reportError?(message: string): void;
}

let store: AttachmentStore | undefined;

/**
 * Upload progress per node key, 0..1, for the decorators to paint. An
 * entry exists only while the bytes are in flight; a node whose source
 * is still 'local' with no entry was interrupted (a reload mid-upload).
 */
const [uploadProgress, setUploadProgress] = createStore<Record<string, number>>(
  {}
);

export { uploadProgress };
export function setUploadProgressFor(key: string, value: number | undefined) {
  setUploadProgress(key, value as number);
}

export function setAttachmentStore(next: AttachmentStore | undefined): void {
  store = next;
}

export function getAttachmentStore(): AttachmentStore | undefined {
  return store;
}

/** Object URLs are made once per hash and kept for the session. */
export function cachedUrlResolver(
  get: (hash: string) => Promise<Blob | null>
): AttachmentStore['resolveUrl'] {
  const cache = new Map<string, Promise<string | null>>();
  return (hash) => {
    let hit = cache.get(hash);
    if (!hit) {
      hit = get(hash).then((blob) => (blob ? URL.createObjectURL(blob) : null));
      cache.set(hash, hit);
    }
    return hit;
  };
}
