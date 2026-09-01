import type { GraphEdge, GraphNode } from '@workspace/persistence-pglite';
import {
  buildForest,
  forestChildren,
  forestPath,
  type Forest,
} from '@workspace/ui/lib/forest';
import { byText } from '@workspace/ui/lib/sort';

/**
 * Containment — the knowledge-graph specialization of the generic forest
 * (`@workspace/ui/lib/forest`) over the FORWARD `contains` relation: the drive
 * folder tree, the canvas, the breadcrumb, and the drop guard.
 *
 * This index is DERIVED, never stored and never synced: it is rebuilt from the
 * nodes and edges the local live queries deliver, so it changes exactly when
 * the underlying rows do. Pure mapping — it never reads or writes the store.
 */

/** A node as the views browse it — the subset the forest and its callers use. */
export type LensNode = {
  id: string;
  kind: string;
  title: string;
  status: string;
};

export type Containment = Forest<LensNode>;

/** The kinds that are containers; everything else is content. */
const FOLDER_KIND = 'folder';
/** Tags are ordinary nodes but never drive content — they are a facet. */
const TAG_KIND = 'tag';

/**
 * Build the containment index from the live nodes and `contains` edges.
 * Edges whose endpoints are not both present are ignored by the generic
 * forest, which is what makes a partially-pulled replica render rather than
 * fail.
 */
export function buildContainment(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): Containment {
  return buildForest(
    nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      status: node.status,
    })),
    edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      position: edge.position,
    }))
  );
}

/** Direct child FOLDERS of a folder. */
export function childFolders(c: Containment, folderId: string): LensNode[] {
  return forestChildren(c, folderId).filter((n) => n.kind === FOLDER_KIND);
}

/** Direct child CONTENT (non-folder, non-tag) of a folder. */
export function childContent(c: Containment, folderId: string): LensNode[] {
  return forestChildren(c, folderId).filter(
    (n) => n.kind !== FOLDER_KIND && n.kind !== TAG_KIND
  );
}

/** Root folders — `folder` nodes with no incoming `contains`. */
export function rootFolders(c: Containment): LensNode[] {
  return [...c.byId.values()]
    .filter((node) => node.kind === FOLDER_KIND && !c.parentOf.has(node.id))
    .sort(byText((node: LensNode) => node.title));
}

/**
 * Root CONTENT — non-folder, non-tag nodes filed under no folder. The drive
 * root lists these next to the root folders, so a document created without a
 * folder is visible where it was made.
 */
export function rootContent(c: Containment): LensNode[] {
  return [...c.byId.values()]
    .filter(
      (node) =>
        node.kind !== FOLDER_KIND &&
        node.kind !== TAG_KIND &&
        !c.parentOf.has(node.id)
    )
    .sort(byText((node: LensNode) => node.title));
}

/** Every folder, by title — the vocabulary of a "move to folder" picker. */
export function allFolders(c: Containment): LensNode[] {
  return [...c.byId.values()]
    .filter((node) => node.kind === FOLDER_KIND)
    .sort(byText((node: LensNode) => node.title));
}

/** Breadcrumb path from the root down to (and including) `folderId`. */
export function pathTo(c: Containment, folderId: string): LensNode[] {
  return forestPath(c, folderId);
}

/**
 * The ancestor folders of a node, NEAREST-first. Unlike {@link pathTo} — which
 * is root→node and includes the node itself for the breadcrumb — this excludes
 * the node and orders outward, so the nearest match is the first one.
 */
export function ancestorsOf(c: Containment, nodeId: string): LensNode[] {
  return forestPath(c, nodeId).slice(0, -1).reverse();
}

/**
 * Is `folderId` the node itself, or inside its subtree? The drop guard: a
 * folder re-parented into its own subtree would orphan a cycle.
 *
 * Answered against the derived forest rather than the store, because a drag
 * asks this on every pointer move — and the forest is already in memory. It
 * is a courtesy, not the fence: the server's own cycle guard is the authority
 * (an offline push bypasses every client check), and the local write path
 * refuses the same shape independently.
 */
export function isSelfOrDescendant(
  c: Containment,
  nodeId: string,
  folderId: string
): boolean {
  if (nodeId === folderId) {
    return true;
  }
  const seen = new Set<string>();
  let cursor: string | undefined = folderId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === nodeId) {
      return true;
    }
    seen.add(cursor);
    cursor = c.parentOf.get(cursor);
  }
  return false;
}
