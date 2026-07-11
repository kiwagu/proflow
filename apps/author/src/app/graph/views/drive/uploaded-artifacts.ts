import type { KbAttributes } from '@/app/graph/graph-data.types';
import {
  childContent,
  childFolders,
  type Containment,
  type LensNode,
} from '@/app/graph/containment';

/**
 * uploaded-artifacts — the ONE shared mechanism behind the cross-lens "Only files"
 * filter and the list-view size column. Every lens (KB browse, the flat filter lenses,
 * the advanced structural trees; NOT Trash) drives its filter/prune/size off THESE
 * pure helpers, so an "uploaded artifact" and a folder's size can never mean two
 * different things in two lenses (lens-feature-component-reuse: one predicate, one
 * prune, one size index).
 *
 * All pure functions over the already-loaded, RLS-narrowed containment forest + the
 * KB attribute satellite — never a query, never access logic.
 */

/**
 * The SINGLE "is this an uploaded artifact" predicate: a `file`/`video` node that has
 * confirmed bytes (a real `media` satellite). A `file`/`video` stub with no
 * `media` (byte-less shell) is NOT an artifact; `text`/`link`/`tag`/`folder` never are.
 */
export function isUploadedArtifact(
  node: LensNode,
  attributes: KbAttributes | undefined
): boolean {
  return (
    (node.kind === 'file' || node.kind === 'video') && attributes?.media != null
  );
}

/**
 * The byte size of a single node, or null when it is not an uploaded artifact (no
 * media satellite / non-media kind). The atomic value the folder-size roll-up sums and
 * the size cell reads for a leaf.
 */
export function artifactBytes(
  node: LensNode,
  attributes: KbAttributes | undefined
): number | null {
  if (!isUploadedArtifact(node, attributes)) {
    return null;
  }
  return attributes?.media?.byteSize ?? null;
}

/**
 * A memoized folder-size index: `nodeId → Σ bytes of all descendant file/video nodes`
 * over the LOADED containment forest, built in ONE post-order pass (compute once per
 * render, never per-cell). A leaf's own artifact bytes count toward its ancestors; a
 * folder with no descendant media is ABSENT from the map (→ the size cell shows "—").
 *
 * HONESTY: the sum is over the RLS-visible / loaded slice — it is the size of what the
 * viewer can see, NOT an authoritative total (the size-column header + the filter chip
 * carry the "visible files" Hint). A server-side rollup is the future scale path.
 *
 * Cycle-guarded via a visiting set (the forest is single-parent, but a malformed
 * containment must never infinite-loop).
 */
export function buildFolderSizeIndex(
  c: Containment,
  bytesOf: (node: LensNode) => number | null
): Map<string, number> {
  const totals = new Map<string, number>();
  // Internal memo carries BOTH the byte sum and whether the subtree holds ANY artifact,
  // so we can tell "no descendant media" (→ absent → the cell shows "—") apart from "has
  // media that happens to sum to 0" (0-byte files → present as "0 B"). Only the former is
  // omitted from the public `totals`.
  const memo = new Map<string, { bytes: number; has: boolean }>();
  const visiting = new Set<string>();

  const sum = (folderId: string): { bytes: number; has: boolean } => {
    const cached = memo.get(folderId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(folderId)) {
      return { bytes: 0, has: false };
    }
    visiting.add(folderId);
    let bytes = 0;
    let has = false;
    for (const child of childContent(c, folderId)) {
      const b = bytesOf(child);
      if (b !== null) {
        has = true;
        bytes += b;
      }
    }
    for (const sub of childFolders(c, folderId)) {
      const r = sum(sub.id);
      if (r.has) {
        has = true;
        bytes += r.bytes;
      }
    }
    visiting.delete(folderId);
    const result = { bytes, has };
    memo.set(folderId, result);
    // Absent when the subtree holds no artifact → the size cell renders "—".
    if (has) {
      totals.set(folderId, bytes);
    }
    return result;
  };

  for (const node of c.byId.values()) {
    if (node.kind === 'folder') {
      sum(node.id);
    }
  }
  return totals;
}

/**
 * A memoized "does this folder's subtree hold ≥1 uploaded artifact" index, built in ONE
 * post-order pass — the tree-prune authority for the advanced view. Distinct from the
 * SIZE index because a 0-byte artifact must still keep its ancestor branch alive (size
 * 0, but present). A folder is in the map iff it (recursively) contains an artifact.
 * Cycle-guarded like {@link buildFolderSizeIndex}.
 */
export function buildFolderHasArtifactIndex(
  c: Containment,
  isArtifact: (node: LensNode) => boolean
): Map<string, boolean> {
  const has = new Map<string, boolean>();
  const visiting = new Set<string>();

  const walk = (folderId: string): boolean => {
    const cached = has.get(folderId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(folderId)) {
      return false;
    }
    visiting.add(folderId);
    let found = childContent(c, folderId).some((child) => isArtifact(child));
    if (!found) {
      found = childFolders(c, folderId).some((sub) => walk(sub.id));
    }
    visiting.delete(folderId);
    has.set(folderId, found);
    return found;
  };

  for (const node of c.byId.values()) {
    if (node.kind === 'folder') {
      walk(node.id);
    }
  }
  return has;
}

/**
 * The ONE prune predicate the advanced (containment-tree) view applies at EVERY
 * recursion point (the grid forest AND the list rows), so a folder is kept iff its
 * subtree holds an uploaded artifact and a leaf is kept iff it IS one — the tree shows
 * WHERE the files live with nesting, empty branches dropped. Returns a `(node) => bool`
 * closure over the two memoized indexes so no per-node recompute happens.
 */
export function makePruneKeep(
  folderHasArtifactIndex: Map<string, boolean>,
  isArtifact: (node: LensNode) => boolean
): (node: LensNode) => boolean {
  return (node: LensNode) =>
    node.kind === 'folder'
      ? (folderHasArtifactIndex.get(node.id) ?? false)
      : isArtifact(node);
}
