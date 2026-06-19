'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
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

import {
  buildContainment,
  childContent,
  childFolders,
  rootFolders,
  type LensNode,
} from './lens-containment';
import { LensCreateResource, type CreateRequest } from './lens-create-resource';
import { iconForKind, kindLabel } from './lens-presentation';
import type { ProjectionViewProps } from './view-registry';

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
 * Authoring (New / Upload / New folder) routes through the landed `LensCreateResource`
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
  onMutated,
  refreshKey,
  spaceId,
  kbData,
}: ProjectionViewProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const containmentEdges = kbData?.containment ?? [];
  const shortcutEdges = kbData?.shortcuts ?? [];

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

  return (
    <div className="bg-background flex min-h-[60vh] min-w-0 flex-1">
      {/* sidebar (230px, prototype-parity) */}
      <nav className="bg-sidebar flex w-[230px] shrink-0 flex-col gap-1 border-r p-3">
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
            <button
              key={item.labelKey}
              type="button"
              onClick={() => setFolderId(null)}
              data-active={item.active}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm',
                'hover:bg-accent',
                item.active ? 'text-foreground font-medium' : 'text-foreground'
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
            </button>
          );
        })}
        <div className="bg-border my-2 h-px" />
        <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-[0.04em] uppercase">
          {t('graph.drive.sections')}
        </div>
        {roots.map((root) => (
          <button
            key={root.id}
            type="button"
            onClick={() => setFolderId(root.id)}
            data-active={folderId === root.id}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm',
              'hover:bg-accent',
              folderId === root.id ? 'bg-accent font-medium' : 'font-normal'
            )}
          >
            <Folder className="text-muted-foreground size-4" aria-hidden />
            <span className="flex-1 truncate">{root.title}</span>
            <span className="text-muted-foreground text-[11px]">
              {childFolders(containment, root.id).length +
                childContent(containment, root.id).length}
            </span>
          </button>
        ))}
      </nav>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* breadcrumb + toolbar */}
        <div className="flex items-center gap-2.5 border-b px-5 py-3">
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => setFolderId(null)}
              className={cn(
                isRoot
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('graph.lens.knowledgeBase')}
            </button>
            {folder ? (
              <>
                <ChevronRight
                  className="text-muted-foreground size-3.5"
                  aria-hidden
                />
                <span className="truncate font-semibold">{folder.title}</span>
              </>
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

        <div className="flex-1 overflow-y-auto p-5">
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
                    layout={layout}
                    selected={item.id === selectedId}
                    onOpen={() => onSelect(item.id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {/* empty states */}
          {isRoot && roots.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              {t('graph.lens.emptyEditor')}
            </p>
          ) : null}
          {!isRoot && folders.length === 0 && items.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              {t('graph.drive.folderEmpty')}
            </p>
          ) : null}
        </div>
      </div>

      <LensCreateResource
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
    </div>
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
}: {
  title: string;
  subtitle: string;
  layout: DriveLayout;
  shortcut?: boolean;
  onOpen: () => void;
}) {
  const list = layout === 'list';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(CARD_BASE, list ? 'gap-3 px-3.5 py-2.5' : 'gap-2.5 p-4')}
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
        <ArrowUpRight className="text-muted-foreground size-3.5" aria-hidden />
      ) : null}
    </button>
  );
}

function ItemCard({
  t,
  node,
  layout,
  selected,
  onOpen,
}: {
  t: GraphTranslator;
  node: LensNode;
  layout: DriveLayout;
  selected: boolean;
  onOpen: () => void;
}) {
  const list = layout === 'list';
  const Icon = iconForKind(node.kind);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-selected={selected}
      className={cn(
        CARD_BASE,
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
        <div className="text-muted-foreground text-xs">
          {kindLabel(t, node.kind)}
        </div>
      </div>
    </button>
  );
}

const CARD_BASE =
  'bg-card hover:border-ring flex w-full items-center rounded-lg border shadow-xs transition-colors';

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
