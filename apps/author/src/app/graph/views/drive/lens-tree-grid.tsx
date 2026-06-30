'use client';

import { SectionLabel } from '@workspace/ui/components/section-label';
import { ChevronRight } from 'lucide-react';
import * as React from 'react';

import type { LensNode } from '@/app/graph/containment';
import { iconForKind } from '@/app/graph/presentation';

/**
 * LensTreeGrid — the parameterizable GRID side of the lens tree (ADR-0025 Step 3). It takes
 * a node-set FOREST and renders it FLAT as path-grouped shelves: the content LEAVES of each
 * container sit on ONE horizontal flex-wrap row, and consecutive groups are separated by a
 * BREADCRUMB of the container's full path (root › … › folder) — the "gallery / Netflix"
 * model. Every matching node stays visible (the consistency the flat lens has) AND its
 * containment is legible (the path crumb), with NO drill and NO nesting indentation.
 *
 * Pure document flow — no sticky, no scroll controller, no per-frame measurement (an earlier
 * sticky-accordion variant jittered because it positioned post-facto from the scroll line).
 * Depth reads from the breadcrumb, not from indentation, so a deep node is never ambiguous.
 *
 * The breadcrumb segments ARE the per-folder affordance: each path folder is a button that
 * reveals it in the KB (`onJumpToFolder`), so there is no separate per-folder jump icon —
 * a folder offered as a crumb already IS the link to it.
 *
 * Neutral over WHICH lens (the §7 naming): it knows nothing about search. The search advanced
 * grid is the first consumer; a recursive Drive/Shared advanced grid consumes it the same way
 * by supplying its own `renderLeaf` + `onJumpToFolder`.
 */

/**
 * One node in a lens tree-grid forest. A `folder` recurses into `children`; any other kind
 * is a content LEAF rendered via `renderLeaf` (a leaf has no `children`). Unbounded depth.
 */
export type LensTreeNode = {
  node: LensNode;
  children: LensTreeNode[];
};

/** A flat path-group: the LEAVES directly under `path`'s last folder, headed by the full
 * breadcrumb `path` (root → container). An empty `path` is the lens root (loose content). */
type PathGroup = { key: string; path: LensNode[]; leaves: LensNode[] };

function isFolder(node: LensNode): boolean {
  return node.kind === 'folder';
}

/**
 * Flatten the forest to path-groups in DFS preorder (a folder's own shelf, then its
 * subfolders' shelves). A folder yields a group when it holds direct content — or when it is
 * a terminal EMPTY folder (no children at all), so a shared empty folder still shows as its
 * own crumb. Path-only folders (subfolders but no direct content) appear only as crumbs.
 */
function buildPathGroups(roots: LensTreeNode[]): PathGroup[] {
  const groups: PathGroup[] = [];
  const rootLeaves = roots.filter((n) => !isFolder(n.node)).map((n) => n.node);
  if (rootLeaves.length > 0) {
    groups.push({ key: 'root', path: [], leaves: rootLeaves });
  }
  const walk = (folder: LensTreeNode, ancestors: LensNode[]) => {
    const path = [...ancestors, folder.node];
    const leaves = folder.children
      .filter((c) => !isFolder(c.node))
      .map((c) => c.node);
    if (leaves.length > 0 || folder.children.length === 0) {
      groups.push({ key: path.map((p) => p.id).join('/'), path, leaves });
    }
    folder.children
      .filter((c) => isFolder(c.node))
      .forEach((sf) => walk(sf, path));
  };
  roots.filter((n) => isFolder(n.node)).forEach((f) => walk(f, []));
  return groups;
}

export function LensTreeGrid({
  roots,
  renderLeaf,
  onJumpToFolder,
  folderTestId,
}: {
  roots: LensTreeNode[];
  /** Render a content LEAF (the lens's card with its own footer/accessory slots). The
   * caller owns all leaf interactivity; the grid only places it on its group's shelf. */
  renderLeaf: (node: LensNode) => React.ReactNode;
  /** Reveal a path folder in the KB — wired to every breadcrumb segment (so the crumb IS
   * the per-folder jump affordance). Omit for a non-clickable path. */
  onJumpToFolder?: (nodeId: string) => void;
  /** Optional testid on each breadcrumb folder segment (the search advanced grid uses
   * `drive-search-tree-folder` so its e2e can read the path folders). */
  folderTestId?: string;
}) {
  const groups = React.useMemo(() => buildPathGroups(roots), [roots]);
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2.5">
          {group.path.length > 0 ? (
            <PathBreadcrumb
              path={group.path}
              onJumpToFolder={onJumpToFolder}
              folderTestId={folderTestId}
            />
          ) : null}
          {group.leaves.length > 0 ? (
            <div className="flex flex-wrap gap-2.5">
              {group.leaves.map((leaf) => (
                <div key={leaf.id} className="w-[264px]">
                  {renderLeaf(leaf)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The full container path as a row of clickable crumbs (root › … › folder); each folder
 * reveals itself in the KB on click. The divider between two shelves. */
function PathBreadcrumb({
  path,
  onJumpToFolder,
  folderTestId,
}: {
  path: LensNode[];
  onJumpToFolder?: (nodeId: string) => void;
  folderTestId?: string;
}) {
  const FolderIcon = iconForKind('folder');
  return (
    <SectionLabel
      density="tight"
      className="flex flex-wrap items-center gap-x-1 gap-y-0.5"
    >
      {path.map((node, idx) => (
        <React.Fragment key={node.id}>
          {idx > 0 ? (
            <ChevronRight className="size-3 shrink-0 opacity-40" aria-hidden />
          ) : null}
          <button
            type="button"
            data-testid={folderTestId}
            onClick={() => onJumpToFolder?.(node.id)}
            disabled={!onJumpToFolder}
            className="hover:text-foreground hover:bg-foreground/10 -mx-0.5 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors disabled:pointer-events-none"
          >
            {idx === 0 ? (
              <FolderIcon className="size-3.5 shrink-0" aria-hidden />
            ) : null}
            <span className="truncate">{node.title}</span>
          </button>
        </React.Fragment>
      ))}
    </SectionLabel>
  );
}
