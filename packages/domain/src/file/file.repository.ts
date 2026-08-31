import type { Result } from 'neverthrow';
import type { BlobProgress } from '../blob/blob.store.js';
import type { FileNode } from './file.do.js';

/**
 * Port: one-shot commands and reads on the file tree.
 *
 * Importing a file is a single command that stores the bytes AND creates the
 * node: a node without bytes (or bytes without a node) is never a valid
 * intermediate state the UI should see.
 */
export interface IFileRepository {
  createFolder(input: {
    parentId: string | null;
    name: string;
    /** Id to give the node. Minted by the caller when it must show the row before the write lands. */
    id?: string;
  }): Promise<Result<FileNode, string>>;
  importFile(input: {
    parentId: string | null;
    name: string;
    blob: Blob;
    id?: string;
    onProgress?: BlobProgress;
  }): Promise<Result<FileNode, string>>;
  get(id: string): Promise<Result<FileNode, string>>;
  /** The live node holding these bytes, if any — the explorer's entry for an attachment. */
  findByBlob(hash: string): Promise<Result<FileNode | null, string>>;
  rename(id: string, name: string): Promise<Result<void, string>>;
  move(id: string, parentId: string | null): Promise<Result<void, string>>;
  setStarred(id: string, starred: boolean): Promise<Result<void, string>>;
  softDelete(id: string): Promise<Result<void, string>>;
  /**
   * Drops stored bytes nothing references any more — deleted nodes, the
   * blobs they held, and anything unpacked from them.
   *
   * Content addressing means deleting a file is not deleting its bytes:
   * another node or a document may hold the same hash. Sweeping is how
   * the storage a deletion promised to free is actually freed. Resolves
   * to the hashes collected.
   */
  collectGarbage(): Promise<Result<string[], string>>;
}
