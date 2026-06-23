'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { CardTile } from '@workspace/ui/components/card-tile';
import { DataTable, type ColumnDef } from '@workspace/ui/components/data-table';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { byText } from '@workspace/ui/lib/sort';
import { cn } from '@workspace/ui/lib/utils';
import {
  ArrowUpRight,
  ChevronRight,
  Clock,
  Database,
  Folder,
  FolderSymlink,
  LayoutGrid,
  List,
  Plus,
  Star,
  Trash2,
  Upload,
  Users,
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
    icon: Database,
    key: 'navKnowledgeBase',
    label: (t) => t('graph.drive.navKnowledgeBase'),
    scope: 'kb',
  },
  {
    icon: Users,
    key: 'navShared',
    label: (t) => t('graph.drive.navShared'),
    comingSoon: true,
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
    comingSoon: true,
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
  // A flat filter lens (Starred / Recent) hides the folder tree, breadcrumb path,
  // and shortcuts — the canvas is a single flat list, not a folder you sit inside.
  const isFilterScope = isStarred || isRecent;
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

  const folders = (
    isStarred
      ? starredNodes.filter((node) => node.kind === 'folder')
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

  // Unified row set for the LIST view (folders → shortcuts → files), each with its
  // open (double-click) / details (single-click) handlers + the ⋯ actions menu —
  // the SAME behaviours as the grid cards, just rendered as table rows.
  const driveRows: DriveRow[] = [
    ...folders.map((sub) => ({
      id: sub.id,
      node: sub,
      rowKind: 'folder' as const,
      onOpen: () => navigate(sub.id),
      onDetails: () => onSelect(sub.id),
      actions: (
        <NodeActionsMenu
          spaceId={spaceId}
          t={t}
          node={sub}
          containment={containment}
          onMutated={onMutated}
          onDetails={() => onSelect(sub.id)}
        />
      ),
    })),
    ...shortcuts.map((target) => ({
      id: `sc-${target.id}`,
      node: target,
      rowKind: 'shortcut' as const,
      onOpen: () =>
        target.kind === 'folder' ? navigate(target.id) : onSelect(target.id),
      onDetails: () => onSelect(target.id),
      actions: null,
    })),
    ...items.map((item) => ({
      id: item.id,
      node: item,
      rowKind: 'item' as const,
      onOpen: () =>
        item.kind === 'text' && onOpenDocument
          ? onOpenDocument(item.id)
          : onSelect(item.id),
      onDetails: () => onSelect(item.id),
      actions: (
        <NodeActionsMenu
          spaceId={spaceId}
          t={t}
          node={item}
          containment={containment}
          onMutated={onMutated}
          onDetails={() => onSelect(item.id)}
          onEdit={
            item.kind === 'text' && onEditNode
              ? () => onEditNode(item.id)
              : undefined
          }
        />
      ),
    })),
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
              // 'kb' + the not-yet-wired stubs return to the tree root (which also
              // resets the scope); 'starred'/'recent' switch to that flat lens.
              item.scope === 'starred' || item.scope === 'recent'
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
            {isStarred ? (
              <Star className="size-3.5" aria-hidden />
            ) : (
              <Clock className="size-3.5" aria-hidden />
            )}
            {isStarred
              ? t('graph.drive.navStarred')
              : t('graph.drive.navRecent')}
          </span>
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
            />
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
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
      </div>
    </div>
  );

  const main = (
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
                {folders.map((sub) => (
                  <FolderCard
                    key={sub.id}
                    title={sub.title}
                    subtitle={t('graph.drive.itemsCount', {
                      count:
                        childFolders(containment, sub.id).length +
                        childContent(containment, sub.id).length,
                    })}
                    layout={layout}
                    onOpen={() => navigate(sub.id)}
                    onDetails={() => onSelect(sub.id)}
                    star={
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
                    }
                    actions={
                      <NodeActionsMenu
                        spaceId={spaceId}
                        t={t}
                        node={sub}
                        containment={containment}
                        onMutated={onMutated}
                        onDetails={() => onSelect(sub.id)}
                        triggerClassName={CARD_ACTION_TRIGGER}
                      />
                    }
                  />
                ))}
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
                {items.map((item) => (
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
                      // Double-click OPENS: a document opens its read-view; every
                      // other kind has no distinct open, so it falls back to Details.
                      item.kind === 'text' && onOpenDocument
                        ? onOpenDocument(item.id)
                        : onSelect(item.id)
                    }
                    onDetails={() => onSelect(item.id)}
                    star={
                      <StarButton
                        starred={starredSet.has(item.id)}
                        onToggle={() =>
                          toggleStar(item.id, !starredSet.has(item.id))
                        }
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
                        onEdit={
                          item.kind === 'text' && onEditNode
                            ? () => onEditNode(item.id)
                            : undefined
                        }
                        triggerClassName={CARD_ACTION_TRIGGER}
                      />
                    }
                  />
                ))}
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
  );

  return (
    <>
      <WorkbenchShell
        panel={{
          kind: 'fixed',
          width: 230,
          'aria-label': t('graph.drive.navKnowledgeBase'),
          children: sidebar,
        }}
        toolbar={toolbar}
        main={main}
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

function FolderCard({
  title,
  subtitle,
  layout,
  shortcut,
  onOpen,
  onDetails,
  star,
  actions,
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
}) {
  const list = layout === 'list';
  const open = useCardOpen(onDetails, onOpen);
  return (
    <div
      className={cn('group relative select-none', list ? 'w-full' : GRID_CARD)}
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
      className={cn('group relative select-none', list ? 'w-full' : GRID_CARD)}
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
}) {
  const columns = React.useMemo<ColumnDef<DriveRow>[]>(
    () => [
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
            <div className="flex min-w-0 items-center gap-2.5">
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
    [t, metaByItem, currentUserId, starredSet, onToggleStar, recentOpenedAt]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      activeRowId={selectedId}
      defaultSorting={defaultSorting}
      // Folders + shortcuts (0) always sort as a block above files (1); the
      // column sort applies within each group, so they never interleave.
      groupOrder={(r) => (r.rowKind === 'item' ? 1 : 0)}
      onRowClick={(r) => r.onDetails()}
      onRowActivate={(r) => r.onOpen()}
    />
  );
}
