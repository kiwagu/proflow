'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { CardTile } from '@workspace/ui/components/card-tile';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
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
import type { ProjectionViewProps } from '@/app/graph/views/registry/projection-view.types';
import {
  buildContainment,
  childContent,
  childFolders,
  pathTo,
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

type NavItem = { icon: LucideIcon; labelKey: string; active?: boolean };

const NAV_ITEMS: readonly NavItem[] = [
  { icon: Database, labelKey: 'graph.drive.navKnowledgeBase', active: true },
  { icon: Users, labelKey: 'graph.drive.navShared' },
  { icon: Clock, labelKey: 'graph.drive.navRecent' },
  { icon: Star, labelKey: 'graph.drive.navStarred' },
  { icon: Trash2, labelKey: 'graph.drive.navTrash' },
];

type DriveLayout = 'grid' | 'list';

export function DriveProjectionView({
  result,
  messages,
  selectedId,
  onSelect,
  onOpenDocument,
  onMutated,
  refreshKey,
  spaceId,
  kbData,
}: ProjectionViewProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const containmentEdges = kbData?.containment ?? [];
  const shortcutEdges = kbData?.shortcuts ?? [];
  const attributesByItem = kbData?.attributesByItem ?? {};
  const metaByItem = kbData?.metaByItem ?? {};
  const currentUserId = kbData?.currentUserId ?? null;

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

  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [layout, setLayout] = React.useState<DriveLayout>('grid');
  const [createRequest, setCreateRequest] =
    React.useState<CreateRequest | null>(null);

  // A mutation may have removed the current folder — fall back to root.
  React.useEffect(() => {
    if (folderId && !containment.byId.has(folderId)) {
      setFolderId(null);
    }
  }, [folderId, containment, refreshKey]);

  const roots = rootFolders(containment);
  const isRoot = folderId == null;
  const folder = isRoot ? null : (containment.byId.get(folderId) ?? null);
  const folders = isRoot
    ? roots
    : folder
      ? childFolders(containment, folder.id)
      : [];
  const shortcuts = isRoot ? [] : (shortcutsByFolder.get(folderId ?? '') ?? []);
  const items = isRoot
    ? []
    : folder
      ? childContent(containment, folder.id)
      : [];

  if (!spaceId) {
    return null;
  }

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
        return (
          <Button
            key={item.labelKey}
            variant="ghost"
            onClick={() => setFolderId(null)}
            data-active={item.active}
            className={cn(
              'h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left font-normal',
              'hover:bg-accent text-foreground',
              item.active && 'bg-accent font-medium'
            )}
          >
            <Icon
              className={cn(
                'size-4',
                item.active ? 'text-foreground' : 'text-muted-foreground'
              )}
              aria-hidden
            />
            {t(item.labelKey)}
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
          onClick={() => setFolderId(root.id)}
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
        <button
          type="button"
          onClick={() => setFolderId(null)}
          className={cn(
            'shrink-0',
            isRoot
              ? 'text-foreground font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('graph.lens.knowledgeBase')}
        </button>
        {/* Full ancestry path (deliberate delta: the prototype showed only the
            immediate folder). Each ancestor is a clickable crumb; the current one
            is bold and inert. */}
        {!isRoot && folder
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
                      onClick={() => setFolderId(crumb.id)}
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
        {!isRoot && folder ? (
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
            onClick={() => setLayout('grid')}
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
            onClick={() => setLayout('list')}
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
      {isRoot ? (
        <div className="text-muted-foreground mb-2 text-[13px]">
          {t('graph.drive.allSections', { count: roots.length })}
        </div>
      ) : null}

      {/* folders + shortcuts */}
      {folders.length > 0 || shortcuts.length > 0 ? (
        <>
          {!isRoot ? (
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
                onOpen={() => setFolderId(sub.id)}
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
                    ? setFolderId(target.id)
                    : onSelect(target.id)
                }
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
                  // A document opens its read-view; every other kind opens the
                  // shared Details panel (the click→read, ⋯→Details split).
                  item.kind === 'text' && onOpenDocument
                    ? onOpenDocument(item.id)
                    : onSelect(item.id)
                }
                actions={
                  <NodeActionsMenu
                    spaceId={spaceId}
                    t={t}
                    node={item}
                    containment={containment}
                    onMutated={onMutated}
                    onDetails={() => onSelect(item.id)}
                    triggerClassName={CARD_ACTION_TRIGGER}
                  />
                }
              />
            ))}
          </div>
        </>
      ) : null}

      {/* empty states */}
      {isRoot && roots.length === 0 ? (
        <EmptyState>{t('graph.lens.emptyEditor')}</EmptyState>
      ) : null}
      {!isRoot && folders.length === 0 && items.length === 0 ? (
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

const GRID_WRAP =
  'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5';
const LIST_WRAP = 'flex flex-col gap-1.5';

function FolderCard({
  title,
  subtitle,
  layout,
  shortcut,
  onOpen,
  actions,
}: {
  title: string;
  subtitle: string;
  layout: DriveLayout;
  shortcut?: boolean;
  onOpen: () => void;
  /** Hover `⋯` action menu for THIS folder. Folders navigate on click, so actions
   * need a separate affordance — a deliberate delta from the prototype (which
   * navigated folders with no action surface). Omitted for shortcut cards. */
  actions?: React.ReactNode;
}) {
  const list = layout === 'list';
  return (
    <div className="group relative">
      <CardTile
        onClick={onOpen}
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
      {actions ? <div className="absolute top-2 right-2">{actions}</div> : null}
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
  actions,
}: {
  t: GraphTranslator;
  node: LensNode;
  attributes?: KbAttributes;
  meta?: NodeMeta;
  currentUserId: string | null;
  layout: DriveLayout;
  selected: boolean;
  onOpen: () => void;
  /** Hover `⋯` action menu for this node (Details opens the panel). */
  actions?: React.ReactNode;
}) {
  const list = layout === 'list';
  const Icon = iconForKind(node.kind);

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
    <div className="group relative">
      <CardTile
        onClick={onOpen}
        data-selected={selected}
        className={cn(
          'w-full',
          list ? 'gap-3 px-3.5 py-2.5' : 'gap-2.5 p-4',
          selected ? 'border-ring ring-ring/35 ring-[3px]' : ''
        )}
      >
        <Icon
          className={cn(
            'text-muted-foreground',
            list ? 'size-[18px]' : 'size-[22px]'
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium">{node.title}</div>
          <div className="text-muted-foreground truncate text-xs">
            {metaLine}
          </div>
        </div>
      </CardTile>
      {actions ? <div className="absolute top-2 right-2">{actions}</div> : null}
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
