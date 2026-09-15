import type { FileKind, IFileTreeReader } from '@workspace/domain';
import type { AppDb } from '../db/db.js';
import { watchQuery } from '../live/watch.js';
import { type FileNodeRow, toFileNode } from './file.mapper.js';

export function graphFileKind(kind: string): FileKind {
  switch (kind) {
    case 'folder':
      return 'folder';
    case 'text':
      return 'document';
    case 'file':
    case 'link':
    case 'video':
      return 'blob';
    default:
      throw new Error(`Unsupported graph file kind: ${kind}`);
  }
}

export type GraphFileRow = Omit<FileNodeRow, 'kind'> & { kind: string };

export const GRAPH_FILE_SELECT = `
  r.id, e.from_id as parent_id, r.kind, r.title as name,
  f.mime, f.size, f.blob_hash, r.body_ref ->> 'doc_id' as document_id,
  coalesce(s.starred, false) as starred, r.created_at, r.updated_at
  from knowledge_resources r
  left join knowledge_edges e on e.to_id = r.id
    and e.space_id = r.space_id and e.relation_type = 'contains'
  left join resource_user_state s on s.resource_id = r.id
    and s.user_id = $2 and s.space_id = r.space_id
  left join file_node f on f.id = r.id`;
export const GRAPH_FILE_LIVE = 'r.space_id = $1 and r.deleted_at is null';

export function toGraphFileNode(row: GraphFileRow) {
  return toFileNode({ ...row, kind: graphFileKind(row.kind) });
}

export function createGraphFileTreeReader(
  db: AppDb,
  spaceId: string,
  userId: string
): IFileTreeReader {
  return {
    watchAll(cb) {
      return watchQuery<GraphFileRow>(
        db,
        `select ${GRAPH_FILE_SELECT} where ${GRAPH_FILE_LIVE}
         order by r.kind = 'folder' desc, lower(r.title), r.created_at`,
        [spaceId, userId],
        (rows) => cb(rows.map(toGraphFileNode))
      );
    },
  };
}
