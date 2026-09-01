import type { FileNode } from '@workspace/domain';

/**
 * Coarse category of a blob-backed file, from its MIME type. Drives the
 * icon and the viewer; unknown types fall back to a download card.
 */
export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'archive'
  | 'word'
  | 'sheet'
  | 'unknown';

export function categoryOf(mime: string | null): FileCategory {
  if (!mime) return 'unknown';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  if (
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'application/gzip' ||
    mime === 'application/x-tar' ||
    mime === 'application/x-7z-compressed'
  )
    return 'archive';
  if (mime.includes('wordprocessingml') || mime === 'application/msword')
    return 'word';
  if (mime.includes('spreadsheetml') || mime === 'text/csv') return 'sheet';
  return 'unknown';
}

/** A file whose bytes are still being written, and where it will land. */
export type PendingImport = {
  id: string;
  name: string;
  parentId: string | null;
  progress: number;
};

/**
 * One row of the explorer: a stored node, or a file still being imported.
 *
 * A file in flight is a row like any other — it has a name and a place in
 * the tree — and the only thing it lacks is stored bytes. Keeping it in
 * the same list is what lets it be listed where it belongs instead of at
 * the end.
 */
export type TreeItem =
  | { row: 'node'; node: FileNode; children: TreeItem[] }
  | { row: 'importing'; file: PendingImport };

/**
 * Where a file being imported belongs among its siblings: after the
 * folders, then by name — the order the reader will deliver it in once it
 * is stored, so the row does not move when the bytes land.
 */
function placeOf(siblings: readonly TreeItem[], file: PendingImport): number {
  const name = file.name.toLowerCase();
  const after = (other: string) => other.toLowerCase().localeCompare(name) > 0;
  const at = siblings.findIndex((item) =>
    item.row === 'importing'
      ? after(item.file.name)
      : item.node.kind !== 'folder' && after(item.node.name)
  );
  return at < 0 ? siblings.length : at;
}

/**
 * Shapes the flat node list into a tree, with the files being imported in
 * their places. Sorted order is the reader's.
 */
export function buildTree(
  nodes: readonly FileNode[],
  importing: readonly PendingImport[] = []
): TreeItem[] {
  const byParent = new Map<string | null, FileNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const build = (parentId: string | null): TreeItem[] => {
    const items: TreeItem[] = (byParent.get(parentId) ?? []).map((node) => ({
      row: 'node',
      node,
      children: node.kind === 'folder' ? build(node.id) : [],
    }));
    for (const file of importing) {
      if (file.parentId === parentId)
        items.splice(placeOf(items, file), 0, { row: 'importing', file });
    }
    return items;
  };
  return build(null);
}

/** Ids of every folder on the path from the root down to `id` (exclusive). */
export function ancestorsOf(nodes: readonly FileNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: string[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  while (cur) {
    path.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return path;
}

/**
 * The placeholders still worth showing.
 *
 * An import writes the bytes first and the node only once they are stored,
 * so the file is a placeholder until then. The node arrives through the
 * live tree the moment its row is committed — before the import call
 * itself has returned — so a placeholder that lives until that call
 * resolves is shown BESIDE the very row it stood in for. It is the same
 * file twice, and the one thing a file manager must never say.
 */
export function pendingToShow(
  pending: readonly PendingImport[],
  nodes: readonly FileNode[]
): PendingImport[] {
  const arrived = new Set(nodes.map((node) => node.id));
  return pending.filter((file) => !arrived.has(file.id));
}

/**
 * Decimal units (1 MB = 1,000,000 bytes), as the browser's own storage
 * panel and the operating system report them — so the numbers here can be
 * compared with those directly.
 */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/**
 * Folders a node may be moved into: the root, then every folder in tree
 * order except the node itself and anything beneath it.
 */
export function moveTargetsFor(
  nodes: readonly FileNode[],
  id: string
): Array<{ id: string | null; name: string; depth: number }> {
  const out: Array<{ id: string | null; name: string; depth: number }> = [
    { id: null, name: 'Files', depth: 0 },
  ];
  const walk = (items: TreeItem[], depth: number) => {
    for (const item of items) {
      if (item.row !== 'node') continue;
      if (item.node.kind !== 'folder' || item.node.id === id) continue;
      out.push({ id: item.node.id, name: item.node.name, depth });
      walk(item.children, depth + 1);
    }
  };
  walk(buildTree(nodes), 1);
  return out;
}
