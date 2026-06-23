import type { ProjectionResultItem } from '@workspace/knowledge-contracts';
import { byText } from '@workspace/ui/lib/sort';
import {
  buildForest,
  forestChildren,
  forestPath,
  type Forest,
} from '@workspace/ui/lib/forest';

import type { ContainmentEdge } from '@/app/graph/graph-data.types';

/**
 * KB containment — the knowledge-graph specialization of the generic forest
 * (`@workspace/ui/lib/forest`) over the FORWARD `contains` forest (ADR-0015): the
 * Drive folder tree, the canvas browser, breadcrumb and per-folder counts. The
 * generic mechanism (build / children / path) lives in `ui/lib`; the KB-domain bits
 * (the `folder`/`tag` kind predicates, the `LensNode` shape) live HERE. SHARED by
 * every graph view — not owned by any one view.
 *
 * Pure mapping over the small RLS-narrowed `contains` edge list the server loaded —
 * never the graph itself, never a write.
 */

/** A node as the views browse it (subset of the resolved item — title + kind). */
export type LensNode = {
  id: string;
  kind: string;
  title: string;
};

export type Containment = Forest<LensNode>;

/** Build the containment index from the resolved items + the `contains` forest. */
export function buildContainment(
  items: ProjectionResultItem[],
  edges: ContainmentEdge[]
): Containment {
  return buildForest(
    items.map((item) => ({ id: item.id, kind: item.kind, title: item.title })),
    edges
  );
}

/** Direct child FOLDERS of a folder. */
export function childFolders(c: Containment, folderId: string): LensNode[] {
  return forestChildren(c, folderId).filter((n) => n.kind === 'folder');
}

/** Direct child CONTENT (non-folder, non-tag) of a folder. */
export function childContent(c: Containment, folderId: string): LensNode[] {
  return forestChildren(c, folderId).filter(
    (n) => n.kind !== 'folder' && n.kind !== 'tag'
  );
}

/** Root folders = `kind=folder` nodes with no incoming `contains` (no parent). */
export function rootFolders(c: Containment): LensNode[] {
  const roots: LensNode[] = [];
  for (const node of c.byId.values()) {
    if (node.kind === 'folder' && !c.parentOf.has(node.id)) {
      roots.push(node);
    }
  }
  return roots.sort(byText((node: LensNode) => node.title));
}

/**
 * Root CONTENT = non-folder/non-tag nodes with no incoming `contains` (loose at
 * the top level, not filed under any folder). The Drive root lists these next to
 * the root folders — the "My Drive" shape (folders + loose files), so a document
 * created without a folder is visible at root, not only via a flat lens.
 */
export function rootContent(c: Containment): LensNode[] {
  const roots: LensNode[] = [];
  for (const node of c.byId.values()) {
    if (
      node.kind !== 'folder' &&
      node.kind !== 'tag' &&
      !c.parentOf.has(node.id)
    ) {
      roots.push(node);
    }
  }
  return roots.sort(byText((node: LensNode) => node.title));
}

/** Folders for a parent-folder picker (all folder nodes, by title). */
export function allFolders(c: Containment): LensNode[] {
  return [...c.byId.values()]
    .filter((n) => n.kind === 'folder')
    .sort(byText((node: LensNode) => node.title));
}

/** Breadcrumb path of folders from the root down to (and including) `folderId`. */
export function pathTo(c: Containment, folderId: string): LensNode[] {
  return forestPath(c, folderId);
}
