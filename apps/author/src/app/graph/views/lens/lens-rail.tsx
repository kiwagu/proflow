'use client';

import type {
  Neighbor,
  NeighborhoodResult,
} from '@workspace/knowledge-contracts';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Tree, type TreeNode } from '@workspace/ui/components/tree';
import { Database, Spline, Tag as TagIcon } from 'lucide-react';
import * as React from 'react';

import {
  childrenNodes,
  descendantContentCount,
  contentNodeCount,
  rootFolders,
  type Containment,
} from './lens-containment';
import { iconForKind } from './lens-presentation';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * LensRail — the prototype GraphTree (slice-11 Ф2 §2). The rail is the graph's
 * containment TREE: a single "Knowledge Base" group → root folders → an
 * expandable graph tree. A folder expands into its `contains` children (from the
 * server-loaded containment forest, synchronous); a CONTENT node expands into its
 * `relates_to` ⊕ `tagged` neighbors (lazy via the frozen `neighborhood` engine
 * port); a TAG expands into the resources tagged with it (lazy, incoming
 * `tagged`). This is the prototype `graphChildren` composite, 1:1.
 *
 * Cycle-guard is delegated to the generic `<Tree>` primitive via the ancestor
 * path. The rail NEVER walks the graph itself for relates_to/tagged — it pulls the
 * `neighborhood` route (ADR-0005 §b). Containment is read from the seed (§7), the
 * one relation the neighborhood port does not expose.
 *
 * REL_MARK: a small icon marks HOW a child is linked (related/tag), mirroring the
 * prototype rail marks.
 */

type RailPayload = {
  kind: string;
  title: string;
  /** how this child is linked into its parent (mark icon). */
  rel?: 'contains' | 'related' | 'tag' | 'tagged-by';
  /** descendant content count, for folders (prototype counter). */
  count?: number;
};

export type LensRailProps = {
  spaceId: string;
  containment: Containment;
  t: GraphTranslator;
  onSelect: (nodeId: string) => void;
  selectedId?: string;
  /** Bumped by the container after a mutation to drop stale lazy children. */
  refreshKey?: number;
  /** Click a folder row → browse it in the canvas (prototype `setSel`). */
  onNavigateFolder: (folderId: string | null) => void;
  /** Click a tag row → toggle its tag facet (prototype `toggleSet(setTags)`). */
  onToggleTag: (tagId: string) => void;
  /** The current browse-scope folder id (null = root) — soft-highlighted. */
  scopeFolderId: string | null;
  /** The active tag-facet ids — soft-highlighted + checked in the rail. */
  activeTagIds: ReadonlySet<string>;
};

/** Map a containment child node to a tree node (synchronous, from the seed). */
function containmentChildToTreeNode(
  c: Containment,
  child: { id: string; kind: string; title: string }
): TreeNode {
  const isFolder = child.kind === 'folder';
  return {
    id: child.id,
    // folders may expand into contains-children; content/tag nodes may expand
    // into relates_to/tagged neighbors (lazy). Everything is potentially a branch.
    hasChildren: true,
    children: isFolder
      ? childrenNodes(c, child.id).map((n) => containmentChildToTreeNode(c, n))
      : undefined,
    data: {
      kind: child.kind,
      title: child.title,
      rel: isFolder ? 'contains' : undefined,
      count: isFolder ? descendantContentCount(c, child.id) : undefined,
    } satisfies RailPayload,
  };
}

/** Map a relates_to/tagged neighbor to a tree node (lazy expansion). */
function neighborToTreeNode(neighbor: Neighbor): TreeNode {
  const rel: RailPayload['rel'] =
    neighbor.relation_type === 'tagged'
      ? neighbor.direction === 'outgoing'
        ? 'tag'
        : 'tagged-by'
      : 'related';
  return {
    id: neighbor.node.id,
    hasChildren: true,
    data: {
      kind: neighbor.node.kind,
      title: neighbor.node.title,
      rel,
    } satisfies RailPayload,
  };
}

export function LensRail({
  spaceId,
  containment,
  t,
  onSelect,
  selectedId,
  refreshKey = 0,
  onNavigateFolder,
  onToggleTag,
  scopeFolderId,
  activeTagIds,
}: LensRailProps) {
  const [kbOpen, setKbOpen] = React.useState(true);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = React.useState<Set<string>>(new Set());
  // lazily-loaded relates_to/tagged children keyed by node id.
  const [lazyChildrenById, setLazyChildrenById] = React.useState<
    Record<string, TreeNode[]>
  >({});

  // Drop lazy children when the graph changes (a mutation refetches the canvas).
  React.useEffect(() => {
    setLazyChildrenById({});
  }, [refreshKey]);

  const roots = React.useMemo<TreeNode[]>(
    () =>
      rootFolders(containment).map((folder) =>
        containmentChildToTreeNode(containment, folder)
      ),
    [containment]
  );

  // Attach lazily-loaded relates_to/tagged children onto leaves that have none
  // from containment (folders already carry their contains children).
  const attachLazy = React.useCallback(
    (node: TreeNode): TreeNode => {
      const payload = node.data as RailPayload;
      const isFolder = payload.kind === 'folder';
      if (isFolder) {
        const children = node.children?.map(attachLazy);
        return children ? { ...node, children } : node;
      }
      const lazy = lazyChildrenById[node.id]?.map(attachLazy);
      return lazy ? { ...node, children: lazy } : node;
    },
    [lazyChildrenById]
  );

  const nodes = React.useMemo(() => roots.map(attachLazy), [roots, attachLazy]);

  const loadNeighbors = React.useCallback(
    async (nodeId: string, kind: string) => {
      setLoadingIds((prev) => new Set(prev).add(nodeId));
      try {
        // content node → related + tags (both); tag → resources tagged-by (in).
        const isTag = kind === 'tag';
        const params = new URLSearchParams({
          space_id: spaceId,
          node_id: nodeId,
          rel: isTag ? 'tagged' : 'relates_to,tagged',
          dir: isTag ? 'incoming' : 'both',
          depth: '1',
        });
        const res = await fetch(`/author/graph/neighborhood?${params}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          return;
        }
        const result = (await res.json()) as NeighborhoodResult;
        const children = result.neighbors.map(neighborToTreeNode);
        setLazyChildrenById((prev) => ({ ...prev, [nodeId]: children }));
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }
    },
    [spaceId]
  );

  const onToggle = React.useCallback(
    (node: TreeNode) => {
      const payload = node.data as RailPayload;
      const isExpanding = !expandedIds.has(node.id);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      // folders carry their children synchronously; content/tag nodes lazy-fetch
      // relates_to/tagged the first time they are expanded.
      if (
        isExpanding &&
        payload.kind !== 'folder' &&
        !lazyChildrenById[node.id]
      ) {
        void loadNeighbors(node.id, payload.kind);
      }
    },
    [expandedIds, lazyChildrenById, loadNeighbors]
  );

  // A rail row activation dispatches by kind (prototype `onLabel`): a FOLDER
  // browses it in the canvas (and clears tag facets), a TAG toggles its facet, a
  // CONTENT node selects (opens the panel). The shared selection still updates so
  // the open node tracks across views.
  const onActivate = React.useCallback(
    (node: TreeNode) => {
      const payload = node.data as RailPayload;
      if (payload.kind === 'folder') {
        onNavigateFolder(node.id);
      } else if (payload.kind === 'tag') {
        onToggleTag(node.id);
      } else {
        onSelect(node.id);
      }
    },
    [onNavigateFolder, onToggleTag, onSelect]
  );

  return (
    <div className="flex flex-col gap-1">
      {/* Knowledge Base group header — clickable (→ root), content count,
          collapsible (prototype RailGroup). */}
      <div
        data-active={kbOpen && scopeFolderId === null}
        className="hover:bg-accent data-[active=true]:bg-accent flex items-center gap-1 rounded-md"
      >
        <button
          type="button"
          onClick={() => setKbOpen((open) => !open)}
          aria-label={t('graph.notion.toggleSection')}
          className="text-muted-foreground grid size-[22px] shrink-0 place-items-center"
        >
          {kbOpen ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => onNavigateFolder(null)}
          className="flex flex-1 items-center gap-2 py-1 text-left text-sm font-medium"
        >
          <Database
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          <span className="flex-1">{t('graph.lens.knowledgeBase')}</span>
          <span className="text-muted-foreground pr-1 text-xs opacity-70">
            {contentNodeCount(containment)}
          </span>
        </button>
      </div>
      {kbOpen && roots.length > 0 ? (
        <Tree
          nodes={nodes}
          expandedIds={expandedIds}
          loadingIds={loadingIds}
          onToggle={onToggle}
          onActivate={onActivate}
          renderLabel={({ node, isBackReference }) => {
            const payload = node.data as RailPayload;
            const Icon = iconForKind(payload.kind);
            const isFolder = payload.kind === 'folder';
            const isTag = payload.kind === 'tag';
            // selected → the open resource (strong). soft → the current scope
            // folder OR an active tag facet (light) — related but not "open".
            const selected = !isFolder && !isTag && node.id === selectedId;
            const soft =
              (isFolder && scopeFolderId === node.id) ||
              (isTag && activeTagIds.has(node.id));
            return (
              <span
                data-selected={selected}
                data-soft={soft}
                className="data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground data-[soft=true]:bg-accent -mx-1 flex flex-1 items-center gap-2 rounded-md px-1"
              >
                {payload.rel === 'related' ? (
                  <Spline className="size-3 shrink-0 opacity-80" aria-hidden />
                ) : payload.rel === 'tag' ? (
                  <TagIcon className="size-3 shrink-0 opacity-80" aria-hidden />
                ) : null}
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                <span
                  className={
                    selected || soft ? 'truncate font-medium' : 'truncate'
                  }
                >
                  {payload.title}
                </span>
                {isTag && soft ? (
                  <Check
                    className="ml-auto size-3 shrink-0 opacity-80"
                    aria-label={t('graph.lens.inFilter')}
                  />
                ) : null}
                {isFolder && payload.count != null ? (
                  <span className="ml-auto text-xs opacity-70">
                    {payload.count}
                  </span>
                ) : null}
                {isBackReference ? (
                  <span className="ml-1 text-xs opacity-70">
                    {t('graph.lens.backReference')}
                  </span>
                ) : null}
              </span>
            );
          }}
        />
      ) : kbOpen ? (
        <p className="text-muted-foreground px-1 py-4 text-xs">
          {t('graph.lens.emptyHubs')}
        </p>
      ) : null}
    </div>
  );
}
