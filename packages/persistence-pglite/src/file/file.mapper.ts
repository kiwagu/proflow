import type { FileKind, FileNode } from '@workspace/domain';

export type FileNodeRow = {
  id: string;
  parent_id: string | null;
  kind: FileKind;
  name: string;
  mime: string | null;
  size: number | string | null;
  blob_hash: string | null;
  document_id: string | null;
  starred: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

export function toFileNode(row: FileNodeRow): FileNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    // bigint comes back as a string from the driver.
    size: row.size === null ? null : Number(row.size),
    blobHash: row.blob_hash,
    documentId: row.document_id,
    starred: row.starred,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
