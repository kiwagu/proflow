'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { ResizableRail } from '@workspace/ui/components/resizable-rail';
import * as React from 'react';

import { buildContainment } from './lens-containment';
import { LensCanvas } from './lens-canvas';
import { LensCreateResource, type CreateRequest } from './lens-create-resource';
import { LensFacets, type HealthFacet } from './lens-facets';
import { LensRail } from './lens-rail';
import { LensSampleButton } from './lens-sample-button';
import type { ProjectionViewProps } from './view-registry';

/**
 * LensProjectionView — the KB lens, ported 1:1 with the prototype LensView
 * (slice-11 Ф2/Ф3). A containment-tree rail (root folders → FORWARD `contains`
 * tree, content/tag nodes expand into relates_to/tagged via the neighborhood port),
 * the type/tag/HEALTH facets, and a folder-browser-OR-flat-filter canvas with
 * breadcrumb + the CreateModal (all kinds). Registered under the `lens` view key
 * (Invariant #1: one entry + one component, zero model/resolver/contract changes).
 *
 * The ResourcePanel is NO LONGER owned here (slice-11 Ф3): it is the SHARED drawer
 * owned by `KbWorkbench` (one panel for all four views, prototype `app.jsx`). The
 * lens receives `selectedId`/`onSelect` from the workbench and renders only its
 * rail/facets/canvas/create; selecting a node bubbles up to open the shared panel.
 *
 * CLIENT component (interactive: browse + lazy expand + authoring), staying
 * presentational per ADR-0005 §(b): the rail pulls the neighborhood through the
 * `neighborhood` engine port; containment + KB attributes + health arrive as a
 * server-loaded RLS-scoped seed (`kbData`); every mutation POSTs to a landed RLS
 * write route. NO traversal or write logic lives here. RLS is the sole authority —
 * an ungranted user resolves to an empty canvas and cannot author.
 */

const RAIL_OPTIONS = {
  storageKey: 'pf.graph.lens.rail.width',
  defaultWidth: 280,
  min: 200,
  max: 460,
};

/** Add/remove a value from a set immutably (facet toggle). */
function toggleInSet<T>(prev: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

export function LensProjectionView({
  result,
  messages,
  spaceId,
  kbData,
  selectedId,
  onSelect,
  onMutated,
  refreshKey,
}: ProjectionViewProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const tagsByItem = kbData?.tagsByItem ?? {};
  const attributesByItem = kbData?.attributesByItem ?? {};
  const healthByItem = kbData?.healthByItem ?? {};
  const containmentEdges = kbData?.containment ?? [];

  const containment = React.useMemo(
    () => buildContainment(result.items, containmentEdges),
    [result.items, containmentEdges]
  );

  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [createRequest, setCreateRequest] =
    React.useState<CreateRequest | null>(null);
  const [activeKinds, setActiveKinds] = React.useState<Set<string>>(new Set());
  const [activeTagIds, setActiveTagIds] = React.useState<Set<string>>(
    new Set()
  );
  const [activeHealth, setActiveHealth] = React.useState<Set<HealthFacet>>(
    new Set()
  );

  // Facets derive from the resolved set, client-side (§3.5).
  const kinds = React.useMemo(
    () =>
      [...new Set(result.items.map((item) => item.kind))]
        .filter((kind) => kind !== 'folder')
        .sort(),
    [result.items]
  );
  const tags = React.useMemo(() => {
    const byId = new Map<string, { id: string; title: string }>();
    for (const list of Object.values(tagsByItem)) {
      for (const tag of list) {
        byId.set(tag.id, tag);
      }
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [tagsByItem]);
  const tagTitleById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const tag of tags) {
      map.set(tag.id, tag.title);
    }
    return map;
  }, [tags]);

  const hasActiveFilter =
    activeKinds.size > 0 || activeTagIds.size > 0 || activeHealth.size > 0;

  // Flat-filter slice (only content nodes — folders are never cards in flat mode).
  const filteredItems = React.useMemo(() => {
    if (!hasActiveFilter) {
      return [];
    }
    return result.items.filter((item) => {
      if (item.kind === 'folder' || item.kind === 'tag') {
        return false;
      }
      if (activeKinds.size > 0 && !activeKinds.has(item.kind)) {
        return false;
      }
      if (activeTagIds.size > 0) {
        const itemTagIds = (tagsByItem[item.id] ?? []).map((tag) => tag.id);
        if (!itemTagIds.some((id) => activeTagIds.has(id))) {
          return false;
        }
      }
      const health = healthByItem[item.id];
      if (activeHealth.has('orphan') && !health?.orphan) {
        return false;
      }
      if (activeHealth.has('stale') && !health?.stale) {
        return false;
      }
      return true;
    });
  }, [
    result.items,
    hasActiveFilter,
    activeKinds,
    activeTagIds,
    activeHealth,
    tagsByItem,
    healthByItem,
  ]);

  const toggleKind = React.useCallback((kind: string) => {
    setActiveKinds((prev) => toggleInSet(prev, kind));
  }, []);
  const toggleTag = React.useCallback((tagId: string) => {
    setActiveTagIds((prev) => toggleInSet(prev, tagId));
  }, []);
  const toggleHealth = React.useCallback((facet: HealthFacet) => {
    setActiveHealth((prev) => toggleInSet(prev, facet));
  }, []);

  const clearFilters = React.useCallback(() => {
    setActiveKinds(new Set());
    setActiveTagIds(new Set());
    setActiveHealth(new Set());
  }, []);

  // Navigating into a folder clears facets (browse mode), prototype-parity.
  const onNavigate = React.useCallback(
    (next: string | null) => {
      setFolderId(next);
      clearFilters();
    },
    [clearFilters]
  );

  if (!spaceId) {
    return null;
  }

  const isEmptyEditor = result.items.length === 0;

  return (
    <div className="flex min-h-[60vh] min-w-0 flex-1 gap-4">
      <ResizableRail
        options={RAIL_OPTIONS}
        aria-label={t('graph.lens.railLabel')}
        className="hidden md:block"
      >
        <LensRail
          spaceId={spaceId}
          containment={containment}
          t={t}
          onSelect={onSelect}
          selectedId={selectedId}
          refreshKey={refreshKey}
        />
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-3 px-1 text-xs">
          <span>{t('graph.lens.legendRelated')}</span>
          <span>{t('graph.lens.legendTag')}</span>
          <span>{t('graph.lens.legendInPath')}</span>
        </div>
        <div className="mt-3 border-t pt-3">
          <LensFacets
            t={t}
            kinds={kinds}
            activeKinds={activeKinds}
            onToggleKind={toggleKind}
            tags={tags}
            activeTagIds={activeTagIds}
            onToggleTag={toggleTag}
            activeHealth={activeHealth}
            onToggleHealth={toggleHealth}
            onClear={clearFilters}
            hasActiveFilter={hasActiveFilter}
          />
        </div>
      </ResizableRail>

      {isEmptyEditor ? (
        <div className="flex min-w-0 flex-1 flex-col items-start gap-4 py-12">
          <p className="text-muted-foreground text-sm">
            {t('graph.lens.emptyEditor')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LensSampleButton
              spaceId={spaceId}
              t={t}
              onSeeded={onMutated}
              prominent
            />
            <button
              type="button"
              onClick={() => setCreateRequest({ parentFolderId: null })}
              className="text-foreground text-sm hover:underline"
            >
              {t('graph.create.new')}
            </button>
          </div>
        </div>
      ) : (
        <LensCanvas
          t={t}
          filteredItems={filteredItems}
          containment={containment}
          tagsByItem={tagsByItem}
          attributesByItem={attributesByItem}
          folderId={folderId}
          onNavigate={onNavigate}
          onSelect={onSelect}
          selectedId={selectedId}
          hasActiveFilter={hasActiveFilter}
          activeKinds={activeKinds}
          activeTagIds={activeTagIds}
          activeHealth={activeHealth}
          tagTitleById={tagTitleById}
          onToggleKind={toggleKind}
          onToggleTag={toggleTag}
          onToggleHealth={toggleHealth}
          onClear={clearFilters}
          onNewFolder={() =>
            setCreateRequest({ kind: 'folder', parentFolderId: folderId })
          }
          onNew={() => setCreateRequest({ parentFolderId: folderId })}
        />
      )}

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
