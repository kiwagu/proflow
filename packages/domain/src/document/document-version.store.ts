import type { Result } from 'neverthrow';
import type { EditAuthor } from '../shared/edit-author.vo.js';
import type { SerializedTree } from './document.do.js';

/** One recorded change: when it happened and who made it. */
export interface EditRecord {
  at: Date;
  author: EditAuthor | null;
  /** Number of low-level operations the change carries. */
  length: number;
}

/** Opaque handle to a point in a document's history. */
export type VersionRef = unknown;

export interface DocumentVersion {
  id: string;
  documentId: string;
  label: string | null;
  kind: 'manual' | 'idle' | 'pre-ai-edit';
  ref: VersionRef;
  createdAt: Date;
}

/**
 * Port: a document's history.
 *
 * Versions are marked explicitly rather than derived from the change log: the
 * underlying history merges consecutive edits by the same author, so it is
 * coarser than the list of saves, while a marked version stays exact.
 */
export interface IDocumentVersionStore {
  /** Marks the document's current state as a version. */
  mark(input: {
    documentId: string;
    label?: string;
    kind: DocumentVersion['kind'];
  }): Promise<Result<DocumentVersion, string>>;
  list(documentId: string): Promise<Result<DocumentVersion[], string>>;
  /** The document's change log, oldest first, with attribution. */
  listEdits(documentId: string): Promise<Result<EditRecord[], string>>;
  /** The document as it was at a version, for a read-only preview. */
  readAt(
    documentId: string,
    ref: VersionRef
  ): Promise<Result<SerializedTree | null, string>>;
  /**
   * Returns the document to an earlier version by appending the inverse of
   * everything since, so the versions in between stay reachable.
   */
  restore(input: {
    documentId: string;
    ref: VersionRef;
    author: EditAuthor;
  }): Promise<Result<void, string>>;
}
