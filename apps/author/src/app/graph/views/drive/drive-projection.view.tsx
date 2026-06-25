'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { CardTile } from '@workspace/ui/components/card-tile';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import { DataTable, type ColumnDef } from '@workspace/ui/components/data-table';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { byText } from '@workspace/ui/lib/sort';
import { cn } from '@workspace/ui/lib/utils';
import {
  ArrowUpRight,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Columns2,
  Database,
  Folder,
  House,
  FolderSymlink,
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';

import type { KbAttributes, NodeMeta } from '@/app/graph/graph-data.types';
import type {
  DriveScope,
  ProjectionViewProps,
} from '@/app/graph/views/registry/projection-view.types';
import {
  buildContainment,
  childContent,
  childFolders,
  pathTo,
  rootContent,
  rootFolders,
  type LensNode,
} from '@/app/graph/containment';
import {
  formatNodeMeta,
  iconForKind,
  kindLabel,
  ownerLabel,
} from '@/app/graph/presentation';
import {
  CreateResource,
  type CreateRequest,
} from '@/app/graph/create-resource.view';
import { NodeActionsMenu } from '@/app/graph/node-actions-menu';
import { usePaneId, useDriveDragState } from '@/app/graph/drive-dnd';
import type { DriveDragData, DriveDropData } from '@/app/graph/drive-dnd';

// Hover-reveal classes for a card's `⋯` action trigger (stays visible while open).
const CARD_ACTION_TRIGGER =
  'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';

// Single vs double click on a card (the Google-Drive split): single click opens
// the shared Details panel, double click OPENS the node (folder → navigate in,
// document → read-view). A lone click defers to Details on a short timer so a
// double-click can cancel it — opening never flashes the Details panel first.
// Keyboard Enter on the card button fires a `detail === 0` click, so it lands on
// Details (the safe, reversible action); opening by keyboard is one Enter further,
// from the panel.
//
// Discrimination is on the click's running count (`event.detail`), NOT the separate
// `dblclick` event: the 2nd click of a pair arrives as `detail === 2` and Opens
// directly. Relying on `dblclick` was fragile — the browser drops it whenever a
// re-render swaps the card element between the two clicks (e.g. the reader's
// focus-refetch firing after the editor round-trip), which silently degraded the
// split. There is also no long-lived "armed" flag to wedge: each click cancels and
// reschedules its own pending Details, so the split can never fall back to
// open-on-single-click.
const CARD_DOUBLE_CLICK_MS = 250;

function useCardOpen(onDetails: () => void, onOpen: () => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  React.useEffect(() => cancel, [cancel]);
  return {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 1) {
        cancel(); // 2nd click of a pair → Open, drop the pending Details.
        onOpen();
        return;
      }
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        onDetails();
      }, CARD_DOUBLE_CLICK_MS);
    },
  };
}

/**
 * DriveProjectionView — the prototype `DriveView`, pixel-1:1 (slice-11 Ф3 §2,
 * ADR-0014 `view='drive'`). The "Google Drive" projection over the SAME graph:
 * folders are container nodes (`kind='folder'`), reached by walking the FORWARD
 * `contains` forest (ADR-0015); a folder may hold `shortcut` cross-links to other
 * folders/targets (Drive-only symlinks, EXCLUDED from containment traversal). A
 * familiar 230px sidebar (New + nav + sections) + breadcrumb + grid/list toggle +
 * folder/shortcut/file cards — the graph stays invisible behind the tree.
 *
 * PURELY presentational (ADR-0005 §b): it consumes the resolved canvas + the
 * server-loaded `contains`/`shortcut` forests (`kbData`); it never queries Supabase
 * or the resolver. Selecting a content node opens the SHARED ResourcePanel (owned
 * by the workbench, via `onSelect`); navigating into a folder is local view state.
 * Authoring (New / Upload / New folder) routes through the landed `CreateResource`
 * modal → RLS write routes. RLS is the sole authority — an ungranted user resolves
 * to an empty Drive and cannot author.
 *
 * Sizes/spacing/typography match the prototype exactly (230px rail, 12px nav pad,
 * 220px grid min, etc.); color is always a token so dark mode works.
 */

/**
 * A sidebar filter. `scope` present = the item is WIRED to a canvas filter
 * (the active one highlights); absent = a not-yet-implemented stub that, for now,
 * just returns to the tree root (Shared / Trash land in later passes). `DriveScope`
 * is the shared type (the workbench owns it in the URL).
 */
type NavItem = {
  icon: LucideIcon;
  /** Stable React key / id for the row. */
  key: string;
  /** Resolves the label with a LITERAL i18n key (keeps keys statically extractable
   * even though the nav is data-driven). */
  label: (t: GraphTranslator) => string;
  scope?: DriveScope;
  /** Not yet available (depends on the access-model work) — rendered muted + inert
   * with a "Coming soon" badge instead of a dead `navigate(null)` stub. */
  comingSoon?: boolean;
};

const NAV_ITEMS: readonly NavItem[] = [
  {
    icon: House,
    key: 'navHome',
    label: (t) => t('graph.drive.navHome'),
    scope: 'home',
  },
  {
    icon: Database,
    key: 'navKnowledgeBase',
    label: (t) => t('graph.drive.navKnowledgeBase'),
    scope: 'kb',
  },
  {
    icon: Users,
    key: 'navShared',
    label: (t) => t('graph.drive.navShared'),
    scope: 'shared',
  },
  {
    icon: Clock,
    key: 'navRecent',
    label: (t) => t('graph.drive.navRecent'),
    scope: 'recent',
  },
  {
    icon: Star,
    key: 'navStarred',
    label: (t) => t('graph.drive.navStarred'),
    scope: 'starred',
  },
  {
    icon: Trash2,
    key: 'navTrash',
    label: (t) => t('graph.drive.navTrash'),
    scope: 'trash',
  },
];

type DriveLayout = 'grid' | 'list';

export function DriveProjectionView({
  result,
  messages,
  selectedId,
  onSelect,
  onOpenDocument,
  onEditNode,
  folderId = null,
  onNavigate,
  scope: scopeProp,
  onScopeChange,
  initialLayout,
  onMutated,
  refreshKey,
  spaceId,
  kbData,
  split = false,
  onToggleSplit,
  hideSidebar = false,
  clipboard,
  onCopyToClipboard,
  onPaste,
  onClearClipboard,
  onRestore,
  onPurge,
}: ProjectionViewProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  // Stable references for the empty fallbacks so the `containment`/`shortcuts`
  // memos below don't recompute every render (a fresh `[]` would invalidate them).
  const containmentEdges = React.useMemo(
    () => kbData?.containment ?? [],
    [kbData]
  );
  const shortcutEdges = React.useMemo(() => kbData?.shortcuts ?? [], [kbData]);
  const attributesByItem = kbData?.attributesByItem ?? {};
  const metaByItem = kbData?.metaByItem ?? {};
  const currentUserId = kbData?.currentUserId ?? null;
  // Per-user "last opened by me" overlay (`resource_id → ISO`); drives the Recent
  // filter (recently VIEWED by me) and its "Viewed" column. Absent key = unopened.
  const openedAtById = kbData?.openedAtById ?? {};

  // Which sidebar filter is active. 'kb' browses the containment tree (the default
  // Drive); 'starred' and 'recent' are flat cross-cutting lenses over the same
  // RLS-resolved canvas — not folders. Opening any folder returns to 'kb'.
  //
  // CONTROLLED when the workbench passes `scope`/`onScopeChange` — it owns the scope
  // in the URL (`?scope=`), so Starred/Recent are shareable + SSR-stable. UNCONTROLLED
  // fallback to local state when omitted (standalone render / tests).
  const controlled = onScopeChange != null;
  const [localScope, setLocalScope] = React.useState<DriveScope>('kb');
  const scope = scopeProp ?? localScope;
  const applyScope = React.useCallback(
    (next: DriveScope) => {
      if (controlled) {
        onScopeChange(next);
      } else {
        setLocalScope(next);
      }
    },
    [controlled, onScopeChange]
  );
  const isStarred = scope === 'starred';
  const isRecent = scope === 'recent';
  const isShared = scope === 'shared';
  const isHome = scope === 'home';
  // The Trash lens (ADR-0018 fork #4): the trashed set (`deleted_at IS NOT NULL`),
  // resolved server-side under the user's RLS and threaded in `kbData.trash`. It is a
  // flat lens — edges among trashed nodes are dormant (both-endpoints-trashed → hidden
  // by the edge SELECT policy), so every trashed node is its own "trashed root". No
  // tree, no shortcuts, no breadcrumb, no DnD, no create/upload — only Restore + Purge.
  const isTrash = scope === 'trash';
  // A flat lens (Home / Starred / Recent / Shared / Trash) hides the folder tree,
  // breadcrumb path, and shortcuts — the canvas is a flat digest/list, not a folder
  // you sit in.
  const isFilterScope = isStarred || isRecent || isShared || isHome || isTrash;
  const starredSet = React.useMemo(
    () => new Set(kbData?.starredIds ?? []),
    [kbData]
  );

  const containment = React.useMemo(
    () => buildContainment(result.items, containmentEdges),
    [result.items, containmentEdges]
  );

  // Shortcuts grouped by source folder (Drive-only symlinks, not containment).
  const shortcutsByFolder = React.useMemo(() => {
    const map = new Map<string, LensNode[]>();
    const ordered = [...shortcutEdges].sort((a, b) => a.position - b.position);
    for (const edge of ordered) {
      const target = containment.byId.get(edge.to);
      if (!target) {
        continue; // RLS-hidden target → drop the symlink card.
      }
      const list = map.get(edge.from);
      if (list) {
        list.push(target);
      } else {
        map.set(edge.from, [target]);
      }
    }
    return map;
  }, [shortcutEdges, containment]);

  // Folder location is CONTROLLED by the workbench via the URL (`?folder=`), so
  // it survives refresh and browser history. `navigate(null)` returns to root.
  // Navigating into the tree always drops back to the 'kb' (browse) scope — the
  // 'starred' filter is a flat lens, never a folder you can sit inside. When the
  // workbench owns the scope it resets it inside `onNavigate`; the local fallback
  // resets here.
  const navigate = React.useCallback(
    (id: string | null) => {
      if (!controlled) {
        setLocalScope('kb');
      }
      onNavigate?.(id);
    },
    [controlled, onNavigate]
  );
  // Grid/list is seeded from the SERVER-read `drive-layout` cookie (so SSR already
  // renders the chosen layout — no post-hydration flip), and the toggle writes it
  // back. A per-device UI preference: a cookie, not localStorage (SSR-consistent,
  // no flash) and not the user profile (no cross-device need).
  const [layout, setLayout] = React.useState<DriveLayout>(
    initialLayout ?? 'grid'
  );
  const applyLayout = React.useCallback((next: DriveLayout) => {
    setLayout(next);
    if (typeof document !== 'undefined') {
      document.cookie = `drive-layout=${next};path=/;max-age=31536000;samesite=lax`;
    }
  }, []);
  const [createRequest, setCreateRequest] =
    React.useState<CreateRequest | null>(null);

  // Toggle this node's per-user starred flag — an UPSERT of the user's own
  // `resource_user_state` row under RLS (sole write authority), then re-resolve so
  // the star + the "Starred" filter reflect the new state. No optimistic flip: the
  // server round-trip is the source of truth (poc-no-fallbacks).
  const toggleStar = React.useCallback(
    (nodeId: string, next: boolean) => {
      if (!spaceId) {
        return;
      }
      void fetch('/author/graph/starred', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, nodeId, starred: next }),
      }).then((res) => {
        if (res.ok) {
          onMutated();
        }
      });
    },
    [spaceId, onMutated]
  );

  // A mutation may have removed the current folder — fall back to root. Clear the
  // stale folder DIRECTLY (not via `navigate`, which also resets `scope`): a setState
  // inside this effect would be a needless cascading render, and the scope is
  // unaffected by a vanished folder.
  React.useEffect(() => {
    if (folderId && !containment.byId.has(folderId)) {
      onNavigate?.(null);
    }
  }, [folderId, containment, refreshKey, onNavigate]);

  // Default ordering is by NAME (human-friendly: case-insensitive, natural) — for
  // BOTH grid and list — instead of the raw containment `position`. `.slice()`
  // before sorting so we never mutate the cached containment/shortcut arrays.
  const byTitle = byText((node: LensNode) => node.title);
  // Recent ordering: most-recently VIEWED BY ME first — the per-user
  // `last_opened_at` overlay (ADR-0016), NOT `updated_at`/activity. An item is in
  // Recent BECAUSE I opened it, so its open time is always defined and is the honest
  // timestamp (true whether or not it was edited). ISO strings compare
  // lexicographically = chronologically.
  const byRecency = (a: LensNode, b: LensNode) =>
    (openedAtById[b.id] ?? '').localeCompare(openedAtById[a.id] ?? '');
  const roots = rootFolders(containment);
  const isRoot = folderId == null;
  const folder = isRoot ? null : (containment.byId.get(folderId) ?? null);

  // The starred set as resolved nodes — `starredIds` mapped through the canvas,
  // dropping ids RLS hid or that no longer resolve. Folders and content split the
  // same way the tree view does, so the Starred canvas reuses every card/row path.
  const starredNodes = isStarred
    ? (kbData?.starredIds ?? [])
        .map((id) => containment.byId.get(id))
        .filter((node): node is LensNode => node != null)
    : [];

  // Recent = the content nodes I have OPENED (a `last_opened_at` overlay entry),
  // folders excluded, most-recently-viewed first. Resolved through the canvas so
  // RLS-hidden ids drop out. Per-user, not space-wide: a fresh user sees an empty
  // Recent until they open something (the open-record write feeds this overlay).
  const recentNodes = isRecent
    ? result.items
        .map((item) => containment.byId.get(item.id))
        .filter(
          (node): node is LensNode =>
            node != null &&
            node.kind !== 'folder' &&
            openedAtById[node.id] != null
        )
    : [];

  // Shared with me = the visible nodes I do NOT own (owner ≠ me), folders + content.
  // A loader lens over the already-RLS-narrowed canvas (ADR-0017 §2.1) — the owner
  // filter is a DISPLAY path, not a fence (the RLS floor is the authority). At Step 1
  // the floor is still 'space', so this surfaces "space-published by someone else".
  const sharedNodes = isShared
    ? result.items
        .map((item) => containment.byId.get(item.id))
        .filter((node): node is LensNode => {
          if (node == null) return false;
          const owner = metaByItem[node.id]?.ownerUserId;
          return owner != null && owner !== currentUserId;
        })
    : [];

  // "For you" home (ADR-0017 §4): a personal DIGEST over the now-personal visible set,
  // not a flat filter. Two sections, content only (folders excluded): what I recently
  // OPENED ("jump back in", `last_opened_at`) and what recently CHANGED that I can see
  // ("recently updated", `last_modified_at`). Both client-side over already-loaded
  // overlays — zero new data/migrations.
  // Cap each section: this is a relevance digest, not an archive — beyond ~50 the
  // entries are stale enough to have lost their "for you" value (and the list would
  // grow unbounded).
  const HOME_LIMIT = 50;
  const homeContent = isHome
    ? result.items
        .map((item) => containment.byId.get(item.id))
        .filter((n): n is LensNode => n != null && n.kind !== 'folder')
    : [];
  const jumpBackNodes = homeContent
    .filter((n) => openedAtById[n.id] != null)
    .sort((a, b) =>
      (openedAtById[b.id] ?? '').localeCompare(openedAtById[a.id] ?? '')
    )
    .slice(0, HOME_LIMIT);
  const recentlyUpdatedNodes = homeContent
    .slice()
    .sort((a, b) =>
      (metaByItem[b.id]?.lastModifiedAt ?? '').localeCompare(
        metaByItem[a.id]?.lastModifiedAt ?? ''
      )
    )
    .slice(0, HOME_LIMIT);

  // The Trash lens set (ADR-0018) — the server-resolved trashed nodes, read from
  // `kbData.trash` (NOT the live `containment`, which is `deleted_at IS NULL`). Sorted
  // by name; folders + content render together (no tree — trashed roots are flat).
  // An empty/ungranted Trash is `[]` → the empty-trash copy.
  const trashNodes: LensNode[] = isTrash
    ? (kbData?.trash.items ?? [])
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
        }))
        .slice()
        .sort(byTitle)
    : [];
  const trashMetaByItem = kbData?.trash.metaByItem ?? {};

  const folders = (
    isStarred
      ? starredNodes.filter((node) => node.kind === 'folder')
      : isShared
        ? sharedNodes.filter((node) => node.kind === 'folder')
        : isFilterScope // 'recent' lists no folders
          ? []
          : isRoot
            ? roots
            : folder
              ? childFolders(containment, folder.id)
              : []
  )
    .slice()
    .sort(byTitle);
  const shortcuts = (
    isFilterScope || isRoot ? [] : (shortcutsByFolder.get(folderId ?? '') ?? [])
  )
    .slice()
    .sort(byTitle);
  const items = (
    isStarred
      ? starredNodes.filter((node) => node.kind !== 'folder')
      : isShared
        ? sharedNodes.filter((node) => node.kind !== 'folder')
        : isRecent
          ? recentNodes
          : isRoot
            ? rootContent(containment) // loose top-level content (no parent folder)
            : folder
              ? childContent(containment, folder.id)
              : []
  )
    .slice()
    .sort(isRecent ? byRecency : byTitle);

  if (!spaceId) {
    return null;
  }

  // Paste the clipboard source INTO this pane's current folder (null → top level).
  // The VIEW builds the "X (copy)" rootTitle (it owns `t`); the workbench POSTs the
  // deep-copy. Only meaningful while a clipboard is set and this pane browses 'kb'.
  const canPaste = clipboard != null && onPaste != null && scope === 'kb';
  const handlePaste = () => {
    if (clipboard && onPaste) {
      onPaste(
        folderId,
        t('graph.panel.copySuffix', { title: clipboard.title })
      );
    }
  };

  // DnD is a 'kb' browse-only affordance (move = re-parent in the containment tree);
  // the flat lenses (Home/Starred/Recent/Shared) are read-only digests, no drag there.
  const dndEnabled = scope === 'kb';

  // Unified row set for the LIST view (folders → shortcuts → files), each with its
  // open (double-click) / details (single-click) handlers + the ⋯ actions menu —
  // the SAME behaviours as the grid cards, just rendered as table rows.
  // In BROWSE (the containment tree) folders carry recursive `subRows` so the list
  // view expands them inline (Dolphin-style). A flat filter lens (Recent/Starred/
  // Shared) has no subRows → the table stays flat. The `ancestors` set guards a
  // malformed containment cycle. The forest is single-parent (first-wins), so each
  // node appears under exactly one parent — no duplicate rows.
  const isTree = !isFilterScope;
  const itemRow = (node: LensNode): DriveRow => ({
    id: node.id,
    node,
    rowKind: 'item',
    onOpen: () =>
      node.kind === 'text' && onOpenDocument
        ? onOpenDocument(node.id)
        : onSelect(node.id),
    onDetails: () => onSelect(node.id),
    actions: (
      <NodeActionsMenu
        spaceId={spaceId}
        t={t}
        node={node}
        containment={containment}
        onMutated={onMutated}
        onDetails={() => onSelect(node.id)}
        onCopyToClipboard={onCopyToClipboard}
        onEdit={
          node.kind === 'text' && onEditNode
            ? () => onEditNode(node.id)
            : undefined
        }
      />
    ),
  });
  const folderRow = (node: LensNode, ancestors: Set<string>): DriveRow => ({
    id: node.id,
    node,
    rowKind: 'folder',
    onOpen: () => navigate(node.id),
    onDetails: () => onSelect(node.id),
    actions: (
      <NodeActionsMenu
        spaceId={spaceId}
        t={t}
        node={node}
        containment={containment}
        onMutated={onMutated}
        onDetails={() => onSelect(node.id)}
        onCopyToClipboard={onCopyToClipboard}
      />
    ),
    subRows:
      isTree && !ancestors.has(node.id)
        ? [
            ...childFolders(containment, node.id).map((f) =>
              folderRow(f, new Set(ancestors).add(node.id))
            ),
            ...childContent(containment, node.id).map(itemRow),
          ]
        : undefined,
  });
  const driveRows: DriveRow[] = [
    ...folders.map((sub) => folderRow(sub, new Set<string>())),
    ...shortcuts.map((target) => ({
      id: `sc-${target.id}`,
      node: target,
      rowKind: 'shortcut' as const,
      onOpen: () =>
        target.kind === 'folder' ? navigate(target.id) : onSelect(target.id),
      onDetails: () => onSelect(target.id),
      actions: null,
    })),
    ...items.map(itemRow),
  ];

  const sidebar = (
    <div className="flex flex-col gap-1">
      <Button
        onClick={() => setCreateRequest({ parentFolderId: folderId })}
        className="mb-2 w-full justify-start"
      >
        <Plus className="size-4" aria-hidden />
        {t('graph.create.new')}
      </Button>
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        // A wired item highlights when its scope is the active one ('kb' stays
        // active even inside a folder); the not-yet-wired stubs never highlight.
        const active = item.scope === scope;
        // Not-yet-available filters (depend on the access-model work) read as muted +
        // inert with a "Coming soon" badge — honest, not a dead navigate-to-root stub.
        if (item.comingSoon) {
          return (
            <div
              key={item.key}
              aria-disabled
              title={t('graph.drive.comingSoon')}
              className="flex h-auto w-full cursor-not-allowed items-center gap-2.5 px-2 py-1.5 text-left text-sm font-normal select-none"
            >
              <Icon
                className="text-muted-foreground/70 size-4 shrink-0"
                aria-hidden
              />
              <span className="text-muted-foreground/70 flex-1 truncate">
                {item.label(t)}
              </span>
              <Badge variant="secondary" className="text-[10px] font-normal">
                {t('graph.drive.comingSoon')}
              </Badge>
            </div>
          );
        }
        return (
          <Button
            key={item.key}
            variant="ghost"
            onClick={() =>
              // 'kb' returns to the tree root (which also resets the scope); any flat
              // lens ('starred'/'recent'/'shared') switches to that scope.
              item.scope && item.scope !== 'kb'
                ? applyScope(item.scope)
                : navigate(null)
            }
            data-active={active}
            className={cn(
              'h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left font-normal',
              'hover:bg-accent text-foreground',
              active && 'bg-accent font-medium'
            )}
          >
            <Icon
              className={cn(
                'size-4',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
              aria-hidden
            />
            {item.label(t)}
          </Button>
        );
      })}
      <div className="bg-border my-2 h-px" />
      <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-[0.04em] uppercase">
        {t('graph.drive.sections')}
      </div>
      {roots.map((root) => (
        <Button
          key={root.id}
          variant="ghost"
          onClick={() => navigate(root.id)}
          data-active={folderId === root.id}
          className={cn(
            'h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left font-normal',
            'hover:bg-accent',
            folderId === root.id && 'bg-accent font-medium'
          )}
        >
          <Folder className="text-muted-foreground size-4" aria-hidden />
          <span className="flex-1 truncate">{root.title}</span>
          <span className="text-muted-foreground text-[11px]">
            {childFolders(containment, root.id).length +
              childContent(containment, root.id).length}
          </span>
        </Button>
      ))}
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-2.5 border-b px-5 py-3">
      <div className="flex min-w-0 items-center gap-1 text-sm">
        {isFilterScope ? (
          // A flat filter lens (Starred / Recent) is not a tree location — a single
          // inert crumb stands in for the folder path.
          <span className="text-foreground flex shrink-0 items-center gap-1.5 font-semibold">
            {isHome ? (
              <House className="size-3.5" aria-hidden />
            ) : isStarred ? (
              <Star className="size-3.5" aria-hidden />
            ) : isShared ? (
              <Users className="size-3.5" aria-hidden />
            ) : isTrash ? (
              <Trash2 className="size-3.5" aria-hidden />
            ) : (
              <Clock className="size-3.5" aria-hidden />
            )}
            {isHome
              ? t('graph.drive.navHome')
              : isStarred
                ? t('graph.drive.navStarred')
                : isShared
                  ? t('graph.drive.navShared')
                  : isTrash
                    ? t('graph.drive.navTrash')
                    : t('graph.drive.navRecent')}
          </span>
        ) : dndEnabled ? (
          // The root crumb is also a drop target: dropping a node here re-parents it
          // to the top level (drop the current contains edge, add no new one).
          <RootDropZone>
            {(over) => (
              <button
                type="button"
                onClick={() => navigate(null)}
                title={t('graph.drive.dropOnRoot')}
                className={cn(
                  'shrink-0 rounded px-1',
                  isRoot
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                  over && 'bg-accent text-foreground ring-ring/50 ring-1'
                )}
              >
                {t('graph.lens.knowledgeBase')}
              </button>
            )}
          </RootDropZone>
        ) : (
          <button
            type="button"
            onClick={() => navigate(null)}
            className={cn(
              'shrink-0',
              isRoot
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('graph.lens.knowledgeBase')}
          </button>
        )}
        {/* Full ancestry path (deliberate delta: the prototype showed only the
            immediate folder). Each ancestor is a clickable crumb; the current one
            is bold and inert. */}
        {!isFilterScope && !isRoot && folder
          ? pathTo(containment, folder.id).map((crumb, index, crumbs) => {
              const isCurrent = index === crumbs.length - 1;
              return (
                <React.Fragment key={crumb.id}>
                  <ChevronRight
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden
                  />
                  {isCurrent ? (
                    <span className="truncate font-semibold">
                      {crumb.title}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(crumb.id)}
                      className="text-muted-foreground hover:text-foreground truncate"
                    >
                      {crumb.title}
                    </button>
                  )}
                </React.Fragment>
              );
            })
          : null}
        {/* current-folder actions (deliberate delta: the card ⋯ acts on a CHILD
            folder; this acts on the folder you are IN) → the shared action menu,
            with Details opening the panel. */}
        {!isFilterScope && !isRoot && folder ? (
          <span className="ml-0.5 shrink-0">
            <NodeActionsMenu
              spaceId={spaceId}
              t={t}
              node={folder}
              containment={containment}
              onMutated={onMutated}
              onDetails={() => onSelect(folder.id)}
              onCopyToClipboard={onCopyToClipboard}
            />
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {/* Paste — appears when a node is on the clipboard (Dolphin model) and this
            pane browses 'kb'; pastes the source INTO this pane's current folder. The
            split-pane's payoff: Copy in A, navigate B, Paste here. The ✕ clears the
            clipboard (also cleared by Escape). */}
        {canPaste && clipboard ? (
          <div className="flex items-center overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={handlePaste}
              title={t(isRoot ? 'graph.drive.pasteRoot' : 'graph.drive.paste', {
                title: clipboard.title,
              })}
              className="hover:bg-accent flex h-7 items-center gap-1.5 px-2 text-sm"
            >
              <ClipboardPaste className="size-[15px]" aria-hidden />
              <span className="max-w-[120px] truncate">{clipboard.title}</span>
            </button>
            <button
              type="button"
              onClick={onClearClipboard}
              aria-label={t('graph.drive.pasteClear')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground grid h-7 w-7 place-items-center border-l"
            >
              <X className="size-[14px]" aria-hidden />
            </button>
          </div>
        ) : null}
        {/* Upload creates into the current location — meaningless in the Trash lens
            (a holding state for trashed nodes, not a place to author into). */}
        {!isTrash ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCreateRequest({ kind: 'file', parentFolderId: folderId })
            }
          >
            <Upload className="size-[15px]" aria-hidden />
            {t('graph.drive.upload')}
          </Button>
        ) : null}
        <div className="flex overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => applyLayout('grid')}
            aria-label={t('graph.drive.layoutGrid')}
            aria-pressed={layout === 'grid'}
            className={cn(
              'grid h-7 w-[30px] place-items-center',
              layout === 'grid'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground'
            )}
          >
            <LayoutGrid className="size-[15px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => applyLayout('list')}
            aria-label={t('graph.drive.layoutList')}
            aria-pressed={layout === 'list'}
            className={cn(
              'grid h-7 w-[30px] place-items-center',
              layout === 'list'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground'
            )}
          >
            <List className="size-[15px]" aria-hidden />
          </button>
        </div>
        {onToggleSplit && scope === 'kb' ? (
          <button
            type="button"
            onClick={onToggleSplit}
            aria-label={t(
              split ? 'graph.drive.splitClose' : 'graph.drive.splitOpen'
            )}
            aria-pressed={split}
            className={cn(
              'grid h-7 w-[30px] place-items-center rounded-md border',
              split ? 'bg-accent text-foreground' : 'text-muted-foreground'
            )}
          >
            <Columns2 className="size-[15px]" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );

  // One content card, reused by the flat items grid and the "For you" home sections.
  // In 'kb' browse it is a drag source (re-parent on drop); flat lenses render plain.
  const renderItemCard = (item: LensNode) => {
    const card = (
      <ItemCard
        key={item.id}
        t={t}
        node={item}
        attributes={attributesByItem[item.id]}
        meta={metaByItem[item.id]}
        currentUserId={currentUserId}
        layout={layout}
        selected={item.id === selectedId}
        onOpen={() =>
          item.kind === 'text' && onOpenDocument
            ? onOpenDocument(item.id)
            : onSelect(item.id)
        }
        onDetails={() => onSelect(item.id)}
        star={
          <StarButton
            starred={starredSet.has(item.id)}
            onToggle={() => toggleStar(item.id, !starredSet.has(item.id))}
            label={t(
              starredSet.has(item.id)
                ? 'graph.drive.unstar'
                : 'graph.drive.star'
            )}
          />
        }
        actions={
          <NodeActionsMenu
            spaceId={spaceId}
            t={t}
            node={item}
            containment={containment}
            onMutated={onMutated}
            onDetails={() => onSelect(item.id)}
            onCopyToClipboard={onCopyToClipboard}
            onEdit={
              item.kind === 'text' && onEditNode
                ? () => onEditNode(item.id)
                : undefined
            }
            triggerClassName={CARD_ACTION_TRIGGER}
          />
        }
      />
    );
    if (!dndEnabled) {
      return card;
    }
    return (
      <DraggableItemCard
        key={item.id}
        {...(card.props as React.ComponentProps<typeof ItemCard>)}
        dragData={{
          type: 'node',
          nodeId: item.id,
          title: item.title,
          kind: item.kind,
        }}
      />
    );
  };

  // "For you" — a personal digest: two sections of content cards. Shown instead of the
  // browse tree / flat list when scope='home'. Respects the grid/list toggle (cards vs
  // list rows); the sortable TABLE is browse-only — it does not fit a 2-section digest.
  const homeSection = (label: string, nodes: LensNode[]) =>
    nodes.length > 0 ? (
      <>
        <SectionLabel className="mt-[18px] first:mt-0">{label}</SectionLabel>
        <div className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}>
          {nodes.map(renderItemCard)}
        </div>
      </>
    ) : null;

  // One trashed row — the node's title + meta line, with Restore + Purge actions
  // (no star, no ⋯ menu, no open/navigate: a trashed node is a holding-state entry,
  // not a browsable item). Purge confirms and surfaces the in-use rejection.
  const renderTrashCard = (node: LensNode) => (
    <TrashCard
      key={node.id}
      t={t}
      node={node}
      meta={trashMetaByItem[node.id]}
      currentUserId={currentUserId}
      layout={layout}
      onRestore={onRestore}
      onPurge={onPurge}
    />
  );

  const main = (
    <>
      {isTrash ? (
        trashNodes.length === 0 ? (
          <EmptyState>{t('graph.trash.empty')}</EmptyState>
        ) : (
          <div className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}>
            {trashNodes.map(renderTrashCard)}
          </div>
        )
      ) : isHome ? (
        jumpBackNodes.length === 0 && recentlyUpdatedNodes.length === 0 ? (
          <EmptyState>{t('graph.drive.homeEmpty')}</EmptyState>
        ) : (
          <>
            {homeSection(t('graph.drive.homeJumpBackIn'), jumpBackNodes)}
            {homeSection(
              t('graph.drive.homeRecentlyUpdated'),
              recentlyUpdatedNodes
            )}
          </>
        )
      ) : (
        <>
          {!isFilterScope && isRoot ? (
            <div className="text-muted-foreground mb-2 text-[13px]">
              {t('graph.drive.allSections', { count: roots.length })}
            </div>
          ) : null}

          {/* contents — a sortable TABLE in list mode, cards in grid mode */}
          {layout === 'list' ? (
            driveRows.length > 0 ? (
              <DriveListTable
                // Remount when the column SET changes (Recent's "Viewed" column vs the
                // "Modified" column elsewhere): the table's sort state is seeded once at
                // mount, so without this it keeps a stale `{id:'viewed'}` sort after
                // leaving Recent and TanStack throws "Column 'viewed' does not exist".
                key={isRecent ? 'recent' : 'browse'}
                rows={driveRows}
                tree={isTree}
                t={t}
                metaByItem={metaByItem}
                currentUserId={currentUserId}
                selectedId={selectedId}
                starredSet={starredSet}
                onToggleStar={toggleStar}
                // In Recent the 4th column is "Viewed" (when I last opened it) instead of
                // "Modified" — that is why the item is here; pass the overlay so the
                // column + sort read it.
                recentOpenedAt={isRecent ? openedAtById : null}
                // Recent defaults to most-recently-VIEWED first (still re-sortable by any
                // column); every other scope sorts by name.
                defaultSorting={
                  isRecent
                    ? [{ id: 'viewed', desc: true }]
                    : [{ id: 'name', desc: false }]
                }
                dndEnabled={dndEnabled}
              />
            ) : null
          ) : (
            <>
              {/* folders + shortcuts */}
              {folders.length > 0 || shortcuts.length > 0 ? (
                <>
                  {!isRoot || isFilterScope ? (
                    <SectionLabel>{t('graph.canvas.folders')}</SectionLabel>
                  ) : null}
                  <div className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}>
                    {folders.map((sub) => {
                      const folderCardProps = {
                        title: sub.title,
                        subtitle: t('graph.drive.itemsCount', {
                          count:
                            childFolders(containment, sub.id).length +
                            childContent(containment, sub.id).length,
                        }),
                        layout,
                        onOpen: () => navigate(sub.id),
                        onDetails: () => onSelect(sub.id),
                        star: (
                          <StarButton
                            starred={starredSet.has(sub.id)}
                            onToggle={() =>
                              toggleStar(sub.id, !starredSet.has(sub.id))
                            }
                            label={t(
                              starredSet.has(sub.id)
                                ? 'graph.drive.unstar'
                                : 'graph.drive.star'
                            )}
                          />
                        ),
                        actions: (
                          <NodeActionsMenu
                            spaceId={spaceId}
                            t={t}
                            node={sub}
                            containment={containment}
                            onMutated={onMutated}
                            onDetails={() => onSelect(sub.id)}
                            onCopyToClipboard={onCopyToClipboard}
                            triggerClassName={CARD_ACTION_TRIGGER}
                          />
                        ),
                      };
                      return dndEnabled ? (
                        <DraggableDroppableFolderCard
                          key={sub.id}
                          {...folderCardProps}
                          dragData={{
                            type: 'node',
                            nodeId: sub.id,
                            title: sub.title,
                            kind: 'folder',
                          }}
                        />
                      ) : (
                        <FolderCard key={sub.id} {...folderCardProps} />
                      );
                    })}
                    {shortcuts.map((target) => (
                      <FolderCard
                        key={`sc-${target.id}`}
                        title={target.title}
                        subtitle={t('graph.drive.shortcutFolder')}
                        layout={layout}
                        shortcut
                        onOpen={() =>
                          target.kind === 'folder'
                            ? navigate(target.id)
                            : onSelect(target.id)
                        }
                        onDetails={() => onSelect(target.id)}
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {/* files / docs */}
              {items.length > 0 ? (
                <>
                  <SectionLabel className="mt-[18px]">
                    {t('graph.canvas.files')}
                  </SectionLabel>
                  <div className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}>
                    {items.map(renderItemCard)}
                  </div>
                </>
              ) : null}
            </>
          )}

          {/* empty states */}
          {isStarred && folders.length === 0 && items.length === 0 ? (
            <EmptyState>{t('graph.drive.starredEmpty')}</EmptyState>
          ) : null}
          {isRecent && items.length === 0 ? (
            <EmptyState>{t('graph.drive.recentEmpty')}</EmptyState>
          ) : null}
          {isShared && folders.length === 0 && items.length === 0 ? (
            <EmptyState>{t('graph.drive.sharedEmpty')}</EmptyState>
          ) : null}
          {!isFilterScope &&
          isRoot &&
          folders.length === 0 &&
          items.length === 0 ? (
            <EmptyState>{t('graph.lens.emptyEditor')}</EmptyState>
          ) : null}
          {!isFilterScope &&
          !isRoot &&
          folders.length === 0 &&
          items.length === 0 ? (
            <EmptyState>{t('graph.drive.folderEmpty')}</EmptyState>
          ) : null}
        </>
      )}
    </>
  );

  return (
    <>
      <WorkbenchShell
        // The split's SECOND pane shares the first pane's sidebar (one nav for both),
        // so it renders sidebar-less — just its own toolbar + canvas.
        panel={
          hideSidebar
            ? undefined
            : {
                kind: 'fixed',
                width: 230,
                'aria-label': t('graph.drive.navKnowledgeBase'),
                children: sidebar,
              }
        }
        toolbar={toolbar}
        main={
          dndEnabled ? (
            <CanvasRootDropZone folderId={folderId}>{main}</CanvasRootDropZone>
          ) : (
            main
          )
        }
      />

      <CreateResource
        spaceId={spaceId}
        t={t}
        containment={containment}
        request={createRequest}
        onOpenChange={(open) => {
          if (!open) {
            setCreateRequest(null);
          }
        }}
        onCreated={onMutated}
      />
    </>
  );
}

// ── cards (prototype FolderCard / ItemCard) ───────────────────────────────

// Grid = flex-wrap of FIXED-width cards (NOT a `1fr` grid): card width must stay
// constant whether the Details panel is open or closed — `1fr`/`minmax` would
// restretch every card when the available width changes, so the icons/tiles
// visibly jump. With a fixed basis (`shrink-0` so two-up rows never squeeze), a
// width change only reflows the column COUNT (pure flex), never the card size —
// and EVERY kind (folder, document, file) shares this one width, so they line up.
// Cards left-align; trailing space is fine. Width is generous so longer titles
// stay readable before they truncate.
const GRID_CARD = 'w-[264px] shrink-0';
const GRID_WRAP = 'flex flex-wrap gap-2.5';
const LIST_WRAP = 'flex flex-col gap-1.5';

/**
 * The per-node star toggle (the only per-user write the Drive surface owns today).
 * On a card it reveals on hover when unstarred — like the ⋯ menu — and stays solid
 * amber once starred so the Starred set reads at a glance; `alwaysShow` keeps it
 * visible inside the table rows, which carry no hover-reveal group.
 */
function StarButton({
  starred,
  onToggle,
  label,
  alwaysShow,
}: {
  starred: boolean;
  onToggle: () => void;
  label: string;
  alwaysShow?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={starred}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'hover:bg-accent grid size-7 shrink-0 place-items-center rounded-md',
        starred || alwaysShow ? 'opacity-100' : CARD_ACTION_TRIGGER
      )}
    >
      <Star
        className={cn(
          'size-4',
          starred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
        )}
        aria-hidden
      />
    </button>
  );
}

/** Drag/drop wiring a card applies to its outer wrapper (the workbench owns the
 * DndContext; the cards just mark themselves draggable / droppable). */
type CardDnd = {
  /** Combined draggable+droppable ref + listeners/attributes for the wrapper. */
  setRef?: (el: HTMLElement | null) => void;
  listeners?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  /** This card is the source being dragged (dim it). */
  dragging?: boolean;
  /** A valid drag is hovering this folder (highlight as the active drop target). */
  dropOver?: boolean;
  /** A drag is in progress and this folder is a VALID landing zone — show a quiet
   * "you can drop here" affordance (distinct from the stronger `dropOver` hover). */
  candidate?: boolean;
};

function FolderCard({
  title,
  subtitle,
  layout,
  shortcut,
  onOpen,
  onDetails,
  star,
  actions,
  dnd,
}: {
  title: string;
  subtitle: string;
  layout: DriveLayout;
  shortcut?: boolean;
  /** Double-click / Open: navigate into the folder (or follow the shortcut). */
  onOpen: () => void;
  /** Single-click: open the shared Details panel for this node. */
  onDetails: () => void;
  /** Per-folder star toggle. Omitted for shortcut cards (a symlink, not a node). */
  star?: React.ReactNode;
  /** Hover `⋯` action menu for THIS folder. Folders navigate on click, so actions
   * need a separate affordance — a deliberate delta from the prototype (which
   * navigated folders with no action surface). Omitted for shortcut cards. */
  actions?: React.ReactNode;
  /** Drag (this folder can be moved) + drop (other nodes re-parent into it). */
  dnd?: CardDnd;
}) {
  const list = layout === 'list';
  const open = useCardOpen(onDetails, onOpen);
  return (
    <div
      ref={dnd?.setRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      className={cn(
        'group relative select-none',
        list ? 'w-full' : GRID_CARD,
        dnd?.dragging && 'opacity-40',
        dnd?.candidate &&
          !dnd?.dropOver &&
          'outline-ring/40 rounded-lg outline-1 outline-offset-1 outline-dashed',
        dnd?.dropOver && 'outline-ring rounded-lg outline-2 outline-offset-1'
      )}
    >
      <CardTile
        {...open}
        className={cn('w-full', list ? 'gap-3 px-3.5 py-2.5' : 'gap-2.5 p-4')}
      >
        {shortcut ? (
          <FolderSymlink
            className={cn(
              'text-muted-foreground',
              list ? 'size-[18px]' : 'size-[22px]'
            )}
            aria-hidden
          />
        ) : (
          <Folder
            className={cn(
              'text-muted-foreground',
              list ? 'size-[18px]' : 'size-[22px]'
            )}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="text-muted-foreground text-xs">{subtitle}</div>
        </div>
        {shortcut ? (
          <ArrowUpRight
            className="text-muted-foreground size-3.5"
            aria-hidden
          />
        ) : null}
      </CardTile>
      {star || actions ? (
        <div className="absolute top-2 right-2 flex items-center gap-0.5">
          {star}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function ItemCard({
  t,
  node,
  attributes,
  meta,
  currentUserId,
  layout,
  selected,
  onOpen,
  onDetails,
  star,
  actions,
  dnd,
}: {
  t: GraphTranslator;
  node: LensNode;
  attributes?: KbAttributes;
  meta?: NodeMeta;
  currentUserId: string | null;
  layout: DriveLayout;
  selected: boolean;
  /** Double-click / Open: a document opens its read-view (other kinds: Details). */
  onOpen: () => void;
  /** Single-click: open the shared Details panel for this node. */
  onDetails: () => void;
  /** Per-node star toggle (reveals on hover; solid amber once starred). */
  star?: React.ReactNode;
  /** Hover `⋯` action menu for this node (Details opens the panel). */
  actions?: React.ReactNode;
  /** Drag wiring (a content card is draggable, but not a drop target). */
  dnd?: CardDnd;
}) {
  const list = layout === 'list';
  const open = useCardOpen(onDetails, onOpen);

  // Meta line (prototype `n.meta || meta.label · owner`): link host / file size /
  // video duration from the REAL `kb` satellites (`resource_media_meta` /
  // `resource_link`). When a satellite row is absent the value is simply null and
  // the line falls back to "{kind} · {owner}" — no mock fill (poc-no-fallbacks).
  const media = {
    byteSize: attributes?.media?.byteSize ?? null,
    durationMs: attributes?.media?.durationMs ?? null,
    mimeType: attributes?.media?.mimeType ?? null,
    linkHost: attributes?.link?.host ?? null,
  };
  const mediaMeta = formatNodeMeta(t, node.kind, media);
  const metaLine =
    mediaMeta ??
    t('graph.drive.metaOwner', {
      kind: kindLabel(t, node.kind),
      owner: ownerLabel(t, meta?.ownerUserId, currentUserId),
    });

  return (
    <div
      ref={dnd?.setRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      className={cn(
        'group relative select-none',
        list ? 'w-full' : GRID_CARD,
        dnd?.dragging && 'opacity-40'
      )}
    >
      <CardTile
        {...open}
        data-selected={selected}
        className={cn(
          'w-full',
          list ? 'gap-3 px-3.5 py-2.5' : 'gap-2.5 p-4',
          selected ? 'border-ring ring-ring/35 ring-[3px]' : ''
        )}
      >
        {React.createElement(iconForKind(node.kind), {
          className: cn(
            'text-muted-foreground',
            list ? 'size-[18px]' : 'size-[22px]'
          ),
          'aria-hidden': true,
        })}
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium">{node.title}</div>
          <div className="text-muted-foreground truncate text-xs">
            {metaLine}
          </div>
        </div>
      </CardTile>
      {star || actions ? (
        <div className="absolute top-2 right-2 flex items-center gap-0.5">
          {star}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * TrashCard — one trashed node in the Trash lens (ADR-0018 §10.7). It is NOT a
 * browsable card: a trashed node has no open / navigate / star / ⋯ menu — only the
 * two lifecycle verbs reached from inside Trash, Restore and Purge.
 *
 * - Restore (`PATCH /author/graph/trash`) clears `deleted_at`; references re-admit
 *   automatically (dormant edges). Owner-sovereign / `delete`-verb gated in the DB.
 * - Purge (`DELETE /author/graph/trash`) is the one-way door — it ALWAYS confirms
 *   first, and when the in-use guard rejects it (living cross-owner references) the
 *   confirm switches to the cooperative "in use" message instead of destroying. The
 *   guard rejection is surfaced gracefully (never thrown).
 */
function TrashCard({
  t,
  node,
  meta,
  currentUserId,
  layout,
  onRestore,
  onPurge,
}: {
  t: GraphTranslator;
  node: LensNode;
  meta?: NodeMeta;
  currentUserId: string | null;
  layout: DriveLayout;
  onRestore?: (nodeId: string) => Promise<boolean>;
  onPurge?: (nodeId: string) => Promise<'purged' | 'in-use' | 'error'>;
}) {
  const list = layout === 'list';
  const [busy, setBusy] = React.useState(false);
  const [confirmPurge, setConfirmPurge] = React.useState(false);
  // When the in-use guard rejects a purge, the confirm dialog stays open and shows the
  // cooperative "in use" message instead of the destructive prompt (nothing destroyed).
  const [inUse, setInUse] = React.useState(false);

  const metaLine = t('graph.drive.metaOwner', {
    kind: kindLabel(t, node.kind),
    owner: ownerLabel(t, meta?.ownerUserId, currentUserId),
  });

  const handleRestore = async () => {
    if (!onRestore) {
      return;
    }
    setBusy(true);
    await onRestore(node.id);
    // Success re-resolves (the row leaves Trash); a no-op (unauthorized) just clears
    // busy. Either way no throw.
    setBusy(false);
  };

  const handlePurge = async () => {
    if (!onPurge) {
      return;
    }
    setBusy(true);
    const outcome = await onPurge(node.id);
    setBusy(false);
    if (outcome === 'in-use') {
      // Cooperative rejection — keep the dialog open, swap to the in-use message.
      setInUse(true);
      return;
    }
    // 'purged' re-resolves (row gone); 'error' is a clean no-op — close either way.
    setConfirmPurge(false);
  };

  return (
    <>
      {/* A trashed node is NOT clickable (no open/navigate) — so this is a plain
          surface DIV, not the clickable CardTile (which is a <button> and would
          nest the Restore/Purge buttons). Same card tokens, no hover-to-ring. */}
      <div
        className={cn(
          'bg-card flex items-center border shadow-xs',
          'rounded-lg',
          list ? 'w-full gap-3 px-3.5 py-2.5' : cn(GRID_CARD, 'gap-2.5 p-4')
        )}
      >
        {React.createElement(iconForKind(node.kind), {
          className: cn(
            'text-muted-foreground',
            list ? 'size-[18px]' : 'size-[22px]'
          ),
          'aria-hidden': true,
        })}
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium">{node.title}</div>
          <div className="text-muted-foreground truncate text-xs">
            {metaLine}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestore}
            disabled={busy || !onRestore}
          >
            <RotateCcw className="size-4" aria-hidden />
            {t('graph.trash.restore')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInUse(false);
              setConfirmPurge(true);
            }}
            disabled={busy || !onPurge}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
            {t('graph.trash.purge')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPurge}
        onOpenChange={(open) => {
          setConfirmPurge(open);
          if (!open) {
            setInUse(false);
          }
        }}
        title={t('graph.trash.purge')}
        description={
          inUse
            ? t('graph.trash.inUse', { title: node.title })
            : t('graph.trash.purgeConfirm', { title: node.title })
        }
        confirmLabel={t('graph.trash.purge')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={handlePurge}
        busy={busy}
        destructive
        confirmIcon={<Trash2 className="size-4" aria-hidden />}
      />
    </>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground mb-2 text-xs font-semibold tracking-[0.04em] uppercase',
        className
      )}
    >
      {children}
    </div>
  );
}

// ── drag & drop card wrappers ─────────────────────────────────────────────
// `useDraggable`/`useDroppable` are hooks, so they can't run inside a `.map()`;
// these one-per-card wrapper components call them and hand the wiring to the card.
// The workbench owns the DndContext + the move/copy mutation; these only mark a card
// as a drag source / drop target. A stable drag id lets the overlay/collision work.

/** Merge dnd-kit's draggable + droppable refs onto one element (folders are both). */
function useMergedRef(
  a?: (el: HTMLElement | null) => void,
  b?: (el: HTMLElement | null) => void
) {
  return React.useCallback(
    (el: HTMLElement | null) => {
      a?.(el);
      b?.(el);
    },
    [a, b]
  );
}

/** A content card (file/doc/video) — a drag SOURCE only (not a drop target). */
function DraggableItemCard(
  props: React.ComponentProps<typeof ItemCard> & { dragData: DriveDragData }
) {
  const { dragData, ...rest } = props;
  const paneId = usePaneId();
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${paneId}:node-${dragData.nodeId}`,
    data: dragData,
  });
  return (
    <ItemCard
      {...rest}
      dnd={{
        setRef: setNodeRef,
        listeners: listeners as Record<string, unknown> | undefined,
        attributes: attributes as unknown as Record<string, unknown>,
        dragging: isDragging,
      }}
    />
  );
}

/** A folder card — a drag SOURCE and a drop TARGET (other nodes re-parent into it). */
function DraggableDroppableFolderCard(
  props: React.ComponentProps<typeof FolderCard> & { dragData: DriveDragData }
) {
  const { dragData, ...rest } = props;
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  const drag = useDraggable({
    id: `${paneId}:node-${dragData.nodeId}`,
    data: dragData,
  });
  const drop = useDroppable({
    id: `${paneId}:folder-${dragData.nodeId}`,
    data: { type: 'folder', folderId: dragData.nodeId } satisfies DriveDropData,
  });
  const setRef = useMergedRef(drag.setNodeRef, drop.setNodeRef);
  // Don't highlight a folder being dragged onto itself (compare the active drag's
  // node id, not the DOM element — the ids carry different prefixes).
  const activeNodeId = (drop.active?.data.current as DriveDragData | undefined)
    ?.nodeId;
  const dropOver = drop.isOver && activeNodeId !== dragData.nodeId;
  // A valid landing zone for the live drag (any folder except this drag's source /
  // its own subtree) — lit up the moment the drag starts.
  const candidate =
    !!dragState &&
    !dragState.isInvalidTarget(dragData.nodeId) &&
    !drag.isDragging;
  return (
    <FolderCard
      {...rest}
      dnd={{
        setRef,
        listeners: drag.listeners as Record<string, unknown> | undefined,
        attributes: drag.attributes as unknown as Record<string, unknown>,
        dragging: drag.isDragging,
        dropOver: dropOver && !drag.isDragging,
        candidate,
      }}
    />
  );
}

/** The breadcrumb "top level" drop zone — dropping here re-parents to the root. */
function RootDropZone({
  children,
}: {
  children: (over: boolean) => React.ReactNode;
}) {
  const paneId = usePaneId();
  const { setNodeRef, isOver } = useDroppable({
    id: `${paneId}:drop-root-crumb`,
    data: { type: 'root' } satisfies DriveDropData,
  });
  return <span ref={setNodeRef}>{children(isOver)}</span>;
}

/**
 * The CANVAS drop zone — wraps the whole content area so a drop on the EMPTY space
 * below the items (not on a folder) re-parents into the folder THIS PANE is currently
 * viewing (the Dolphin/Finder model: dropping in the open folder lands in it; the
 * breadcrumb is for going up). At the root that means the top level — so this also
 * serves the "drop on empty space → root" case. Fills the pane height (`min-h-full`)
 * so the empty area is catchable; lights up dashed while a drag is active and solid on
 * hover. The custom `driveCollision` keeps folders winning when the pointer is on them.
 */
function CanvasRootDropZone({
  folderId,
  children,
}: {
  folderId: string | null;
  children: React.ReactNode;
}) {
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  // Dropping into the folder we're viewing is invalid only when THAT folder is the
  // active node itself or its descendant (can't re-parent into your own subtree).
  const invalid =
    !!folderId && !!dragState && dragState.isInvalidTarget(folderId);
  const { setNodeRef, isOver } = useDroppable({
    id: `${paneId}:drop-canvas`,
    disabled: invalid,
    data: (folderId
      ? { type: 'folder', folderId }
      : { type: 'root' }) satisfies DriveDropData,
  });
  const active = !!dragState && !invalid;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-full rounded-lg',
        active &&
          'outline-ring/30 outline-1 -outline-offset-2 transition-colors outline-dashed',
        isOver && 'bg-accent/40 outline-ring/70'
      )}
    >
      {children}
    </div>
  );
}

/**
 * Per-row drag/drop wiring for the LIST/TREE table. Runs INSIDE each table row's own
 * component (`DataTableRow`), so the dnd hooks here are rules-of-hooks safe. A
 * content/folder ROW is a drag source; a FOLDER row is also a drop target (re-parent
 * into it). Shortcut rows (symlinks, not nodes) are inert. The returned `rowProps`
 * (ref + listeners + draggable attrs) and `isDropTarget` flag are spread by the table.
 */
function useDriveRowDnd(row: DriveRow): {
  rowProps?: React.HTMLAttributes<HTMLTableRowElement> & {
    ref?: React.Ref<HTMLTableRowElement>;
  };
  isDropTarget?: boolean;
  isCandidate?: boolean;
} | void {
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  const draggable = row.rowKind !== 'shortcut';
  const isFolder = row.rowKind === 'folder';
  const drag = useDraggable({
    id: `${paneId}:row-node-${row.id}`,
    disabled: !draggable,
    data: {
      type: 'node',
      nodeId: row.node.id,
      title: row.node.title,
      kind: row.node.kind,
    } satisfies DriveDragData,
  });
  const drop = useDroppable({
    id: `${paneId}:row-folder-${row.id}`,
    disabled: !isFolder,
    data: { type: 'folder', folderId: row.node.id } satisfies DriveDropData,
  });
  if (row.rowKind === 'shortcut') {
    return undefined;
  }
  const setRef = (el: HTMLTableRowElement | null) => {
    drag.setNodeRef(el);
    if (isFolder) {
      drop.setNodeRef(el);
    }
  };
  const activeNodeId = (drop.active?.data.current as DriveDragData | undefined)
    ?.nodeId;
  const dropOver = isFolder && drop.isOver && activeNodeId !== row.node.id;
  const candidate =
    isFolder &&
    !!dragState &&
    !dragState.isInvalidTarget(row.node.id) &&
    !drag.isDragging;
  return {
    rowProps: {
      ref: setRef,
      ...(drag.attributes as unknown as React.HTMLAttributes<HTMLTableRowElement>),
      ...(drag.listeners as unknown as React.HTMLAttributes<HTMLTableRowElement>),
      className: cn(drag.isDragging && 'opacity-40'),
    },
    isDropTarget: dropOver && !drag.isDragging,
    isCandidate: candidate,
  };
}

// ── list view (table) ─────────────────────────────────────────────────────

/** One Drive row for the table view — a folder, a shortcut, or a content item. */
type DriveRow = {
  id: string;
  node: LensNode;
  rowKind: 'folder' | 'shortcut' | 'item';
  /** Double-click / Enter: navigate in / open the reader. */
  onOpen: () => void;
  /** Single click: open the shared Details panel. */
  onDetails: () => void;
  /** Hover `⋯` actions (folders/items); shortcuts have none. */
  actions: React.ReactNode | null;
  /** Tree mode (browse): a folder's children (folders then content), recursively.
   * Undefined in flat lenses → the table renders flat. */
  subRows?: DriveRow[];
};

/**
 * DriveListTable — the LIST layout: the same folders/shortcuts/files rendered as a
 * sortable table (the generic {@link DataTable}) instead of stretched cards. Row
 * interaction matches the cards (single → Details, double → open). Columns are
 * domain/i18n here; the generic table base lives in `@workspace/ui` and is ready to
 * grow (pagination / filtering / column visibility / selection) for richer screens.
 */
function DriveListTable({
  rows,
  t,
  metaByItem,
  currentUserId,
  selectedId,
  starredSet,
  onToggleStar,
  recentOpenedAt,
  defaultSorting,
  tree = false,
  dndEnabled = false,
}: {
  rows: DriveRow[];
  t: GraphTranslator;
  metaByItem: Record<string, NodeMeta>;
  currentUserId: string | null;
  selectedId?: string;
  /** Non-null in Recent (`resource_id → ISO last_opened_at`): the 4th column shows
   * "Viewed" from it instead of "Modified" from `updated_at`. */
  recentOpenedAt: Record<string, string> | null;
  /** Initial column sort (Recent → viewed-desc; otherwise name-asc). */
  defaultSorting: { id: string; desc: boolean }[];
  starredSet: Set<string>;
  onToggleStar: (nodeId: string, next: boolean) => void;
  /** Browse tree: folders expand inline (a chevron + depth indent in the name cell,
   * `subRows` drive the children). Off → a flat table. */
  tree?: boolean;
  /** Wire rows as drag sources / folder rows as drop targets (move = re-parent).
   * Only in 'kb' browse — flat lenses are read-only digests. */
  dndEnabled?: boolean;
}) {
  const columns = React.useMemo<ColumnDef<DriveRow>[]>(
    () => [
      // Tree only: a HIDDEN rank (folders/shortcuts 0, files 1) pinned as the primary
      // sort, so "folders first" holds at every level regardless of the column sort
      // direction (the visible column becomes the secondary sort). Auto-hidden by the
      // DataTable's `pinnedSort`.
      ...(tree
        ? [
            {
              id: 'group',
              accessorFn: (r: DriveRow) => (r.rowKind === 'item' ? 1 : 0),
              enableSorting: true,
              sortingFn: 'basic' as const,
              header: '',
              cell: () => null,
            },
          ]
        : []),
      {
        id: 'star',
        header: '',
        enableSorting: false,
        // Shortcuts are symlinks, not nodes — nothing to star.
        cell: ({ row }) =>
          row.original.rowKind === 'shortcut' ? null : (
            <StarButton
              alwaysShow
              starred={starredSet.has(row.original.node.id)}
              onToggle={() =>
                onToggleStar(
                  row.original.node.id,
                  !starredSet.has(row.original.node.id)
                )
              }
              label={t(
                starredSet.has(row.original.node.id)
                  ? 'graph.drive.unstar'
                  : 'graph.drive.star'
              )}
            />
          ),
        meta: { cellClassName: 'w-10' },
      },
      {
        id: 'name',
        accessorFn: (r) => r.node.title,
        header: t('graph.table.name'),
        cell: ({ row }) => {
          const r = row.original;
          const Icon =
            r.rowKind === 'folder'
              ? Folder
              : r.rowKind === 'shortcut'
                ? FolderSymlink
                : iconForKind(r.node.kind);
          return (
            <div
              className="flex min-w-0 items-center gap-2.5"
              style={tree ? { paddingLeft: row.depth * 18 } : undefined}
            >
              {tree ? (
                row.getCanExpand() ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      row.getToggleExpandedHandler()();
                    }}
                    className="text-muted-foreground hover:text-foreground -ml-1 shrink-0 rounded p-0.5"
                    aria-label={t(
                      row.getIsExpanded()
                        ? 'graph.tree.collapse'
                        : 'graph.tree.expand'
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 transition-transform',
                        row.getIsExpanded() && 'rotate-90'
                      )}
                      aria-hidden
                    />
                  </button>
                ) : (
                  // Align leaf rows with the chevron of expandable siblings.
                  <span className="size-3.5 shrink-0" aria-hidden />
                )
              ) : null}
              <Icon
                className="text-muted-foreground size-[18px] shrink-0"
                aria-hidden
              />
              <span className="truncate font-medium">{r.node.title}</span>
              {r.rowKind === 'shortcut' ? (
                <ArrowUpRight
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden
                />
              ) : null}
            </div>
          );
        },
        meta: { cellClassName: 'max-w-[460px]' },
      },
      {
        id: 'type',
        accessorFn: (r) => kindLabel(t, r.node.kind),
        header: t('graph.table.type'),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
        meta: { cellClassName: 'w-32' },
      },
      {
        id: 'owner',
        accessorFn: (r) =>
          ownerLabel(t, metaByItem[r.node.id]?.ownerUserId, currentUserId),
        header: t('graph.table.owner'),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
        meta: { cellClassName: 'w-32' },
      },
      // In Recent the timestamp column is "Viewed" (when I last opened it, from the
      // per-user overlay) — the reason the item is here; everywhere else it is
      // "Modified" (the node row's `updated_at`).
      {
        id: recentOpenedAt ? 'viewed' : 'modified',
        accessorFn: (r) =>
          (recentOpenedAt
            ? recentOpenedAt[r.node.id]
            : metaByItem[r.node.id]?.lastModifiedAt) ?? '',
        header: t(
          recentOpenedAt ? 'graph.table.viewed' : 'graph.table.modified'
        ),
        cell: ({ getValue }) => {
          const v = getValue() as string;
          return (
            <span className="text-muted-foreground">
              {v ? new Date(v).toLocaleDateString() : '—'}
            </span>
          );
        },
        meta: { cellClassName: 'w-32' },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.actions ? (
            // Stop the row's open/details from firing when using the ⋯ menu.
            <div
              role="presentation"
              className="flex justify-end"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.actions}
            </div>
          ) : null,
        meta: { cellClassName: 'w-10' },
      },
    ],
    [
      t,
      metaByItem,
      currentUserId,
      starredSet,
      onToggleStar,
      recentOpenedAt,
      tree,
    ]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      activeRowId={selectedId}
      defaultSorting={defaultSorting}
      // Browse tree: folders expand inline via `subRows`, and a pinned hidden "group"
      // rank keeps folders above files at EVERY level (direction-stable). Flat lenses
      // pass neither → the flat group-order block applies instead.
      getSubRows={tree ? (r) => r.subRows : undefined}
      pinnedSort={tree ? 'group' : undefined}
      // Folders + shortcuts (0) always sort as a block above files (1); the
      // column sort applies within each group, so they never interleave.
      groupOrder={(r) => (r.rowKind === 'item' ? 1 : 0)}
      onRowClick={(r) => r.onDetails()}
      onRowActivate={(r) => r.onOpen()}
      // 'kb' browse only: each row is a drag source, folder rows are drop targets
      // (move = re-parent). `useDriveRowDnd` runs inside each row's own component, so
      // its dnd hooks are rules-of-hooks safe across tree expand/collapse.
      rowDnd={dndEnabled ? useDriveRowDnd : undefined}
    />
  );
}
