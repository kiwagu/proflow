'use client';

import * as React from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * Tree — a generic, purely-presentational expandable tree primitive. Data lives
 * OUTSIDE the component: the caller supplies an array of `TreeNode`s and a
 * render-prop for each node's label. Expansion is a controlled set of node ids;
 * a node is a branch when it declares `hasChildren`, and its children are
 * resolved lazily by the caller (this primitive never fetches).
 *
 * It carries NO domain semantics — no notion of "related" / "tags" / "resource".
 * Depth indents, a twirl chevron toggles a branch, and a cycle-guard derived
 * from the ancestor path prevents an already-visited id from rendering its
 * subtree again (it renders the label only, flagged as a back-reference). This
 * keeps it reusable for any graph-shaped data while the consumer owns meaning.
 *
 * Styling is strictly semantic tokens (no hardcoded color), Lucide at the
 * standard control stroke, `gap-*` spacing — design-language compliant.
 */

export type TreeNode = {
  /** Stable id; also used for the expansion set + cycle-guard ancestor path. */
  id: string;
  /** Whether a twirl is shown (the node MAY expand to children). */
  hasChildren?: boolean;
  /** Already-loaded children; absent until the caller lazily loads them. */
  children?: TreeNode[];
  /** Opaque per-node payload the render-prop reads (kept generic). */
  data?: unknown;
};

export type TreeRenderNodeArgs = {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  loading: boolean;
  /** True when this id already appeared on the ancestor path (a back-reference). */
  isBackReference: boolean;
};

export type TreeProps = {
  nodes: TreeNode[];
  /** Controlled expansion set (node ids). */
  expandedIds: ReadonlySet<string>;
  /** Node ids currently loading their children (shows a spinner on the twirl). */
  loadingIds?: ReadonlySet<string>;
  /** Toggle a branch — the caller flips expansion + lazily loads children. */
  onToggle: (node: TreeNode) => void;
  /** Optional row activation (e.g. open a panel) distinct from twirl toggle. */
  onActivate?: (node: TreeNode) => void;
  /** Render-prop for a node's label region (right of the twirl). */
  renderLabel: (args: TreeRenderNodeArgs) => React.ReactNode;
  className?: string;
};

const INDENT_REM = 1.25;

function TreeRow({
  node,
  depth,
  ancestorPath,
  expandedIds,
  loadingIds,
  onToggle,
  onActivate,
  renderLabel,
}: {
  node: TreeNode;
  depth: number;
  ancestorPath: ReadonlySet<string>;
  expandedIds: ReadonlySet<string>;
  loadingIds: ReadonlySet<string>;
  onToggle: (node: TreeNode) => void;
  onActivate?: (node: TreeNode) => void;
  renderLabel: (args: TreeRenderNodeArgs) => React.ReactNode;
}) {
  const isBackReference = ancestorPath.has(node.id);
  const expanded = expandedIds.has(node.id) && !isBackReference;
  const loading = loadingIds.has(node.id);
  const canExpand = Boolean(node.hasChildren) && !isBackReference;

  const nextPath = React.useMemo(() => {
    const set = new Set(ancestorPath);
    set.add(node.id);
    return set;
  }, [ancestorPath, node.id]);

  return (
    <li role="treeitem" aria-expanded={canExpand ? expanded : undefined}>
      <div
        className="hover:bg-accent flex items-center gap-1 rounded-md py-1 pr-2 transition-colors"
        style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
      >
        {canExpand ? (
          <button
            type="button"
            aria-label="toggle"
            onClick={() => onToggle(node)}
            className="text-muted-foreground hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ChevronRight
                className={cn(
                  'size-4 transition-transform',
                  expanded && 'rotate-90'
                )}
                aria-hidden
              />
            )}
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onActivate?.(node)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          {renderLabel({ node, depth, expanded, loading, isBackReference })}
        </button>
      </div>
      {expanded && node.children && node.children.length > 0 ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              ancestorPath={nextPath}
              expandedIds={expandedIds}
              loadingIds={loadingIds}
              onToggle={onToggle}
              onActivate={onActivate}
              renderLabel={renderLabel}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function Tree({
  nodes,
  expandedIds,
  loadingIds = EMPTY_SET,
  onToggle,
  onActivate,
  renderLabel,
  className,
}: TreeProps) {
  return (
    <ul role="tree" className={cn('flex flex-col', className)}>
      {nodes.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          ancestorPath={EMPTY_SET}
          expandedIds={expandedIds}
          loadingIds={loadingIds}
          onToggle={onToggle}
          onActivate={onActivate}
          renderLabel={renderLabel}
        />
      ))}
    </ul>
  );
}
