'use client';

import type { ProjectionResultItem } from '@workspace/knowledge-contracts';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { FacetChip } from '@workspace/ui/components/facet-chip';
import { RailSectionHeading } from '@workspace/ui/components/rail-section-heading';
import {
  ChevronRight,
  Database,
  Filter,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
} from 'lucide-react';

import type { KbAttributes, ResourceTag } from '@/app/graph/graph-page.data';
import {
  childContent,
  childFolders,
  pathTo,
  rootFolders,
  descendantContentCount,
  type Containment,
  type LensNode,
} from './lens-containment';
import type { HealthFacet } from './lens-facets';
import { iconForKind, kindLabel } from './lens-presentation';

/**
 * LensCanvas — the prototype KBCanvas (slice-11 Ф2 §4): a folder BROWSER when no
 * facet is active (subfolders + content cards + breadcrumb over FORWARD `contains`)
 * and a flat FILTER slice across the whole set when a facet narrows. Both read the
 * already-resolved, already-RLS-narrowed set; the flat slice narrows it
 * CLIENT-SIDE (the narrowed items are passed in). Containment browse walks the
 * server-loaded containment forest (§7). Purely presentational: clicking a card
 * selects the node (opening the panel); clicking a folder navigates into it.
 */

export type LensCanvasProps = {
  t: GraphTranslator;
  /** flat-filter result (already narrowed by facets) — used when filtering. */
  filteredItems: ProjectionResultItem[];
  containment: Containment;
  tagsByItem: Record<string, ResourceTag[]>;
  attributesByItem: Record<string, KbAttributes>;
  /** current browse folder (null = root). */
  folderId: string | null;
  onNavigate: (folderId: string | null) => void;
  onSelect: (nodeId: string) => void;
  selectedId?: string;
  hasActiveFilter: boolean;
  /** active facet chips (rendered above the grid while filtering). */
  activeKinds: ReadonlySet<string>;
  activeTagIds: ReadonlySet<string>;
  activeHealth: ReadonlySet<HealthFacet>;
  tagTitleById: Map<string, string>;
  onToggleKind: (kind: string) => void;
  onToggleTag: (tagId: string) => void;
  onToggleHealth: (facet: HealthFacet) => void;
  onClear: () => void;
  onNewFolder: () => void;
  onNew: () => void;
};

export function LensCanvas({
  t,
  filteredItems,
  containment,
  tagsByItem,
  attributesByItem,
  folderId,
  onNavigate,
  onSelect,
  selectedId,
  hasActiveFilter,
  activeKinds,
  activeTagIds,
  activeHealth,
  tagTitleById,
  onToggleKind,
  onToggleTag,
  onToggleHealth,
  onClear,
  onNewFolder,
  onNew,
}: LensCanvasProps) {
  const folder = folderId ? (containment.byId.get(folderId) ?? null) : null;
  const path = folderId ? pathTo(containment, folderId) : [];

  // Browse vs flat-filter (prototype KBCanvas branching).
  const subfolders: LensNode[] = hasActiveFilter
    ? []
    : folder
      ? childFolders(containment, folder.id)
      : rootFolders(containment);
  const contentItems: { id: string; kind: string; title: string }[] =
    hasActiveFilter
      ? filteredItems
      : folder
        ? childContent(containment, folder.id)
        : [];

  const headerCount = hasActiveFilter
    ? t('graph.canvas.matchesCount', { count: contentItems.length })
    : t('graph.canvas.foldersFilesCount', {
        folders: subfolders.length,
        files: contentItems.length,
      });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* header — breadcrumb + title + counts + actions */}
      <div className="flex flex-col gap-3 border-b pb-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary text-primary-foreground grid size-10 shrink-0 place-items-center rounded-lg">
            {folder ? (
              <FolderOpen className="size-5" aria-hidden />
            ) : (
              <Database className="size-5" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {folder ? (
              <nav className="text-muted-foreground mb-1 flex flex-wrap items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => onNavigate(null)}
                  className="hover:text-foreground"
                >
                  {t('graph.lens.knowledgeBase')}
                </button>
                {path.map((crumb, index) => (
                  <span key={crumb.id} className="flex items-center gap-1">
                    <ChevronRight className="size-3" aria-hidden />
                    <button
                      type="button"
                      onClick={() => onNavigate(crumb.id)}
                      className={
                        index === path.length - 1
                          ? 'text-foreground font-medium'
                          : 'hover:text-foreground'
                      }
                    >
                      {crumb.title}
                    </button>
                  </span>
                ))}
              </nav>
            ) : null}
            <h2 className="font-heading truncate text-2xl">
              {folder ? folder.title : t('graph.lens.knowledgeBase')}
            </h2>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={onNewFolder}>
              <FolderPlus className="size-4" aria-hidden />
              {t('graph.canvas.newFolder')}
            </Button>
            <Button size="sm" onClick={onNew}>
              <Plus className="size-4" aria-hidden />
              {t('graph.create.new')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{headerCount}</span>
          {hasActiveFilter
            ? [...activeKinds].map((kind) => (
                <FacetChip
                  key={`k-${kind}`}
                  label={kindLabel(t, kind)}
                  onRemove={() => onToggleKind(kind)}
                  removeLabel={t('graph.lens.clearFilter')}
                />
              ))
            : null}
          {hasActiveFilter
            ? [...activeTagIds].map((tagId) => (
                <FacetChip
                  key={`t-${tagId}`}
                  label={tagTitleById.get(tagId) ?? tagId}
                  onRemove={() => onToggleTag(tagId)}
                  removeLabel={t('graph.lens.clearFilter')}
                />
              ))
            : null}
          {hasActiveFilter
            ? [...activeHealth].map((facet) => (
                <FacetChip
                  key={`h-${facet}`}
                  label={
                    facet === 'orphan'
                      ? t('graph.lens.healthOrphanChip')
                      : t('graph.lens.healthStaleChip')
                  }
                  onRemove={() => onToggleHealth(facet)}
                  removeLabel={t('graph.lens.clearFilter')}
                />
              ))
            : null}
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
            >
              {t('graph.lens.clearFilter')}
            </button>
          ) : null}
        </div>
      </div>

      {hasActiveFilter ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Filter className="size-3.5" aria-hidden />
          {t('graph.canvas.flatSliceNote')}
        </p>
      ) : null}

      {/* folder cards (browse) */}
      {subfolders.length > 0 ? (
        <section className="flex flex-col gap-2">
          {!hasActiveFilter && folder ? (
            <RailSectionHeading className="tracking-wide uppercase">
              {t('graph.canvas.folders')}
            </RailSectionHeading>
          ) : null}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {subfolders.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => onNavigate(sub.id)}
                className="hover:border-ring bg-card flex items-center gap-3 rounded-lg border p-4 text-left shadow-xs transition-colors"
              >
                <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-md">
                  <Folder className="size-4.5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {sub.title}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t('graph.canvas.resourcesCount', {
                      count: descendantContentCount(containment, sub.id),
                    })}
                  </div>
                </div>
                <ChevronRight
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* resource cards */}
      {contentItems.length > 0 ? (
        <section className="flex flex-col gap-2">
          {!hasActiveFilter && folder && subfolders.length > 0 ? (
            <RailSectionHeading className="tracking-wide uppercase">
              {t('graph.canvas.files')}
            </RailSectionHeading>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {contentItems.map((item) => {
              const Icon = iconForKind(item.kind);
              const tags = tagsByItem[item.id] ?? [];
              const attrs = attributesByItem[item.id];
              const selected = item.id === selectedId;
              return (
                <Card
                  key={item.id}
                  data-selected={selected}
                  onClick={() => onSelect(item.id)}
                  className="hover:border-ring data-[selected=true]:border-ring cursor-pointer transition-colors"
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{item.title}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {attrs?.description ? (
                      <p className="text-muted-foreground line-clamp-2 text-sm">
                        {attrs.description}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {kindLabel(t, item.kind)}
                      </Badge>
                      <Badge variant="outline">
                        {(item as ProjectionResultItem).status ?? ''}
                      </Badge>
                      {(item as ProjectionResultItem).body_ref != null ? (
                        <Badge variant="outline" className="gap-1">
                          <FileText className="size-3" aria-hidden />
                          {t('graph.body.present')}
                        </Badge>
                      ) : null}
                    </div>
                    {tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <Badge
                            key={tag.id}
                            variant="outline"
                            className="text-xs"
                          >
                            {tag.title}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* empty states */}
      {!hasActiveFilter && !folder && subfolders.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t('graph.lens.emptyEditor')}
        </p>
      ) : null}
      {!hasActiveFilter && !folder && subfolders.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('graph.canvas.rootHint')}
        </p>
      ) : null}
      {hasActiveFilter && contentItems.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t('graph.lens.empty')}
        </p>
      ) : null}
      {!hasActiveFilter &&
      folder &&
      subfolders.length === 0 &&
      contentItems.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t('graph.lens.empty')}
        </p>
      ) : null}
    </div>
  );
}
