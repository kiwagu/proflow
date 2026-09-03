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

/**
 * Columns of a file node as the explorer sees it. A native document's name
 * is its title, read from the document row so a rename in the editor shows
 * up in the tree without a second write.
 */
export const FILE_NODE_SELECT = `
  f.id, f.parent_id, f.kind,
  coalesce(d.title, f.name) as name,
  f.mime, f.size, f.blob_hash, f.document_id, f.starred,
  f.created_at, greatest(f.updated_at, coalesce(d.updated_at, f.updated_at)) as updated_at
  from file_node f
  left join document d on d.id = f.document_id`;

export const FILE_NODE_LIVE = 'f.deleted_at is null and d.deleted_at is null';

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
