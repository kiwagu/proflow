/** What a blob store knows about stored bytes, independent of any file name. */
export interface BlobInfo {
  hash: string;
  size: number;
  mime: string;
}

export type BlobProgress = (done: number, total: number) => void;

/**
 * Port: content-addressed storage of raw bytes.
 *
 * Bytes are keyed by their hash, so storing the same content twice costs
 * nothing and a reference from a document is a string that never goes stale.
 * Names, folders and ownership are NOT the store's concern — they live on
 * file nodes, which reference a blob by hash.
 */
export interface IBlobStore {
  /**
   * Stores the bytes and resolves to their identity. Idempotent.
   * `onProgress` reports bytes processed so far out of the total; a file
   * is hashed and then written, so it runs twice over the length.
   */
  put(blob: Blob, onProgress?: BlobProgress): Promise<BlobInfo>;
  /** The stored bytes as a lazily-backed Blob, or null when unknown. */
  get(hash: string): Promise<Blob | null>;
  has(hash: string): Promise<boolean>;
  delete(hash: string): Promise<void>;
  /**
   * Every hash the store holds, with the space it takes.
   *
   * Content addressing means the store cannot tell on its own whether
   * anything still wants a given blob — only the database knows that. So
   * reclaiming space is a comparison between the two, and this is the
   * store's half of it.
   */
  list(): Promise<Array<{ hash: string; size: number }>>;
  /**
   * Throws away everything the store holds, stored bytes and unpacked
   * packages alike. For starting over, not for housekeeping.
   */
  clear(): Promise<void>;
}
