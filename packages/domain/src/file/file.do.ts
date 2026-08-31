/**
 * Everything the explorer shows is a file node. A folder groups nodes; a
 * native document is a node pointing at a `document` row; every other file
 * is a node pointing at a content-addressed blob and carrying its MIME type.
 *
 * "Document" is deliberately a kind of file, not a separate concept: the
 * explorer is the one place where all of the user's material is aggregated,
 * and a Word file and a native document sit in the same tree.
 */
export type FileKind = 'folder' | 'document' | 'blob';

export interface FileNode {
  id: string;
  parentId: string | null;
  kind: FileKind;
  name: string;
  /** MIME type for blob-backed files; null for folders and native documents. */
  mime: string | null;
  /** Byte size for blob-backed files; null otherwise. */
  size: number | null;
  /** Content hash of the stored bytes for blob-backed files. */
  blobHash: string | null;
  /** The `document` this node stands for, for native documents. */
  documentId: string | null;
  starred: boolean;
  createdAt: Date;
  updatedAt: Date;
}
