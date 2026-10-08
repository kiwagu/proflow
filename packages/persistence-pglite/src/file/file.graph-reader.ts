import type { FileKind, FileNode, IFileTreeReader } from '@workspace/domain';
import type { AppDb } from '../db/db.js';
import { watchQuery } from '../live/watch.js';
import { type FileNodeRow, toFileNode } from './file.mapper.js';

/**
 * The resource kinds the file tree shows. A space also holds graph
 * vocabulary the Drive has no row for — tags today, whatever the server adds
 * tomorrow — and the policy is that such a resource is simply not a file:
 * it is left out at the query, and a row that still reaches the mapper with
 * an unmapped kind is skipped with a warning rather than failing the whole
 * tree. One unexpected kind must never blank the user's files.
 */
export const GRAPH_FILE_KINDS = [
  'folder',
  'text',
  'file',
  'link',
  'video',
] as const;

/** The tree's kind for a resource kind, or null for one the tree does not show. */
export function graphFileKind(kind: string): FileKind | null {
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
      return null;
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
export const GRAPH_FILE_LIVE = `r.space_id = $1 and r.deleted_at is null and r.kind in (${GRAPH_FILE_KINDS.map(
  (kind) => `'${kind}'`
).join(', ')})`;

export function toGraphFileNode(row: GraphFileRow): FileNode | null {
  const kind = graphFileKind(row.kind);
  return kind === null ? null : toFileNode({ ...row, kind });
}

/**
 * The rows the tree shows, with every unmapped kind skipped and reported
 * once per kind — the one place the row set is mapped whole.
 */
export function toGraphFileNodes(
  rows: readonly GraphFileRow[],
  onSkippedKind: (kind: string) => void
): FileNode[] {
  const nodes: FileNode[] = [];
  const skipped = new Set<string>();
  for (const row of rows) {
    const node = toGraphFileNode(row);
    if (node) {
      nodes.push(node);
    } else if (!skipped.has(row.kind)) {
      skipped.add(row.kind);
      onSkippedKind(row.kind);
    }
  }
  return nodes;
}

export type GraphFileTreeReaderOptions = {
  /** Told once per kind that reached the mapper without a place in the tree. */
  onSkippedKind?: (kind: string) => void;
};

export function createGraphFileTreeReader(
  db: AppDb,
  spaceId: string,
  userId: string,
  options: GraphFileTreeReaderOptions = {}
): IFileTreeReader {
  const onSkippedKind =
    options.onSkippedKind ??
    ((kind: string) =>
      console.warn(
        `file tree: resource kind "${kind}" has no place in the tree and was skipped`
      ));
  return {
    watchAll(cb) {
      return watchQuery<GraphFileRow>(
        db,
        `select ${GRAPH_FILE_SELECT} where ${GRAPH_FILE_LIVE}
         order by r.kind = 'folder' desc, lower(r.title), r.created_at`,
        [spaceId, userId],
        (rows) => cb(toGraphFileNodes(rows, onSkippedKind))
      );
    },
  };
}
