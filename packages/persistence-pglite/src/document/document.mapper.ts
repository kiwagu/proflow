import type { DocumentKind, DocumentMeta } from '@workspace/domain';

export interface DocumentRow {
  id: string;
  title: string;
  kind: string;
  preview: string;
  starred: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

export function toDocumentMeta(row: DocumentRow): DocumentMeta {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as DocumentKind,
    preview: row.preview,
    starred: row.starred,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
