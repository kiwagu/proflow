import type { SearchResultItem } from '@workspace/knowledge-contracts';
import { byText } from '@workspace/ui/lib/sort';

import {
  type Containment,
  type LensNode,
  childContent,
  childFolders,
} from '@/app/graph/containment';

/**
 * The advanced (extended) search render is a FILTERED KB: the matched leaves placed in
 * their FULLY-EXPANDED ancestor-folder tree (the advanced reframe). A node in
 * the tree is either a matched HIT (a search result — carries the snippet) or a PATH
 * folder (an ancestor of some hit, rendered so the full nesting from root → match is
 * visible, even with no direct match of its own). Recursive + UNBOUNDED depth: the tree
 * mirrors the `contains` forest down every path-to-a-match, at whatever depth.
 *
 * This is the SAME shape the KB / Shared advanced lens renders (a containment tree over
 * a node-set), specialized to search: the node-set is hits ∪ all their ancestors, and a
 * hit row carries a snippet highlight — the ONLY thing that differs from a KB row.
 */
export type SearchTreeNode = {
  node: LensNode;
  /** The matched search-result row when this node is a HIT (carries the snippet + the
   * renderable meta the Details panel needs), else null for a path-only ancestor folder.
   * A non-null `hit` is the `isHit` discriminant. */
  hit: SearchResultItem | null;
  /** Nested children (path folders + hits), already ordered (folders first, by title).
   * Unbounded depth — the forest recurses to every match. */
  children: SearchTreeNode[];
};

/**
 * Build the fully-expanded hits-in-their-ancestor-tree forest for the advanced search
 * view. `hitIds` is the set of matched result ids; `containment` is the FULL space
 * forest (the default projection resolves the whole space, so every accessible hit's
 * ancestor chain is known). Returns the ROOTS of the nested forest.
 *
 * Node-set = the hits ∪ ALL their ancestor folders (walk `parentOf` up to the root). The
 * tree then nests the full path automatically. A node whose containing folder is NOT in
 * the set (an out-of-canvas hit — rare, only if the default projection were row-limited)
 * has no in-set parent → it roots, with NO synthetic ancestors (graceful-absence, the
 * SAME pattern the Drive advanced lens uses). Children at every level are ordered folders
 * first (by title), then content (by title); HITS keep `contains`-forest order among
 * content via the title sort, deterministic and depth-independent.
 */
export function buildSearchTree(
  hits: readonly SearchResultItem[],
  containment: Containment
): SearchTreeNode[] {
  const hitById = new Map<string, SearchResultItem>();
  for (const hit of hits) {
    hitById.set(hit.id, hit);
  }

  // The node-set: every hit + every ancestor folder on its path to the root. The walk is
  // `parentOf` up to root — unbounded, no depth cap. A hit with no in-set ancestor chain
  // (parent missing from the forest) simply contributes only itself; it roots below.
  const nodeSet = new Set<string>();
  for (const id of hitById.keys()) {
    nodeSet.add(id);
    let cursor = containment.parentOf.get(id);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      nodeSet.add(cursor);
      cursor = containment.parentOf.get(cursor);
    }
  }

  const byTitle = byText((n: LensNode) => n.title);
  const toNode = (n: LensNode, children: SearchTreeNode[]): SearchTreeNode => ({
    node: n,
    hit: hitById.get(n.id) ?? null,
    children,
  });

  // Recurse from a folder: its in-set child folders (recursed) then its in-set child
  // content. Pure recursion over the forest — UNBOUNDED depth, no cap.
  const buildChildren = (folderId: string): SearchTreeNode[] => {
    const folders = childFolders(containment, folderId)
      .filter((f) => nodeSet.has(f.id))
      .slice()
      .sort(byTitle)
      .map((f) => toNode(f, buildChildren(f.id)));
    const content = childContent(containment, folderId)
      .filter((c) => nodeSet.has(c.id))
      .slice()
      .sort(byTitle)
      .map((c) => toNode(c, []));
    return [...folders, ...content];
  };

  // Roots = in-set nodes whose parent is NOT in the set (top of a path-to-a-match, or an
  // out-of-canvas hit). Folders recurse; a root that is itself a content hit has no
  // children. Folders first, then content, each by title.
  const rootFolders: SearchTreeNode[] = [];
  const rootContent: SearchTreeNode[] = [];
  for (const id of nodeSet) {
    const parent = containment.parentOf.get(id);
    if (parent && nodeSet.has(parent)) {
      continue; // not a root — rendered under its in-set parent.
    }
    // An OUT-OF-CANVAS hit (search is a superset of the resolved canvas) is not in the
    // containment forest, so synthesize its `LensNode` from the hit row itself — it roots
    // with no children (graceful-absence, no synthetic ancestors).
    const hit = hitById.get(id);
    const node: LensNode | undefined =
      containment.byId.get(id) ??
      (hit ? { id: hit.id, kind: hit.kind, title: hit.title } : undefined);
    if (!node) {
      continue; // defensive: an id with neither a forest node nor a hit row.
    }
    const treeNode = toNode(
      node,
      node.kind === 'folder' ? buildChildren(id) : []
    );
    (node.kind === 'folder' ? rootFolders : rootContent).push(treeNode);
  }
  rootFolders.sort((a, b) => byTitle(a.node, b.node));
  rootContent.sort((a, b) => byTitle(a.node, b.node));
  return [...rootFolders, ...rootContent];
}
