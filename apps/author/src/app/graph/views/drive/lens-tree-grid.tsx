'use client';

import * as React from 'react';

import type { LensNode } from '@/app/graph/containment';
import { iconForKind } from '@/app/graph/presentation';

/**
 * LensTreeGrid — the parameterizable GRID side of the lens tree (ADR-0025 Step 3): a
 * node-set FOREST rendered as nested folder SECTIONS (a folder header at its depth, its
 * children indented one step deeper) with each content LEAF rendered through an injected
 * `renderLeaf` slot. The recursive, UNBOUNDED-depth counterpart of the {@link LensListTable}
 * tree (list) — the two share the SAME forest shape so a lens's grid + list tree can never
 * drift.
 *
 * Neutral over WHICH lens (the §7 naming): it knows nothing about search — it walks a
 * `LensTreeNode[]` forest and renders folder headers + the caller's leaf slot. The search
 * advanced grid is the first consumer (the matched leaves in their fully-expanded ancestor
 * tree, with the snippet footer + the reveal affordance on each leaf card); a future
 * recursive Drive grid would consume it the same way by supplying its own `renderLeaf`.
 *
 * Read-only structure: a folder header is purely presentational (no open / drill — the
 * caller's leaf slot owns all interactivity). Path folders are ancestors rendered so the
 * full root→leaf nesting is visible even with no direct hit of their own.
 */

/**
 * One node in a lens tree-grid forest. A `folder` renders a header and recurses into
 * `children`; any other kind is a content LEAF rendered via the `renderLeaf` slot (a leaf
 * has no `children`). Unbounded depth — the forest recurses to every leaf.
 */
export type LensTreeNode = {
  node: LensNode;
  children: LensTreeNode[];
};

/** Indentation per tree level (px) — shared with the list tree's `row.depth * 18`. */
const INDENT_STEP = 18;

/** A non-folder node is a content leaf, rendered through the caller's slot. */
function isFolder(node: LensNode): boolean {
  return node.kind === 'folder';
}

export function LensTreeGrid({
  roots,
  renderLeaf,
  folderTestId,
}: {
  roots: LensTreeNode[];
  /** Render a content LEAF (the lens's card with its own footer/accessory slots). The
   * caller owns all leaf interactivity; the grid only positions it at its tree depth. */
  renderLeaf: (node: LensNode) => React.ReactNode;
  /** Optional testid on each folder header (the search advanced grid uses
   * `drive-search-tree-folder` so its e2e can read the path-folder rows). */
  folderTestId?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {roots.map((root) => (
        <LensTreeGridNode
          key={root.node.id}
          entry={root}
          depth={0}
          renderLeaf={renderLeaf}
          folderTestId={folderTestId}
        />
      ))}
    </div>
  );
}

function LensTreeGridNode({
  entry,
  depth,
  renderLeaf,
  folderTestId,
}: {
  entry: LensTreeNode;
  depth: number;
  renderLeaf: (node: LensNode) => React.ReactNode;
  folderTestId?: string;
}) {
  const indent = { paddingLeft: depth * INDENT_STEP } as const;
  if (isFolder(entry.node)) {
    return (
      <div className="flex flex-col gap-1.5">
        {/* A structural folder header at its depth — not a card. Recurses to its
            children at depth+1; UNBOUNDED. */}
        <div
          data-testid={folderTestId}
          className="text-muted-foreground flex items-center gap-1.5 py-0.5 text-xs font-semibold tracking-[0.02em] uppercase"
          style={indent}
        >
          {React.createElement(iconForKind('folder'), {
            className: 'size-3.5',
            'aria-hidden': true,
          })}
          <span className="truncate">{entry.node.title}</span>
        </div>
        {entry.children.map((child) => (
          <LensTreeGridNode
            key={child.node.id}
            entry={child}
            depth={depth + 1}
            renderLeaf={renderLeaf}
            folderTestId={folderTestId}
          />
        ))}
      </div>
    );
  }
  return (
    <div style={indent}>
      <div className="w-[264px]">{renderLeaf(entry.node)}</div>
    </div>
  );
}
