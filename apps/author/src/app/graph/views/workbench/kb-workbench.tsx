'use client';

import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar';
import { Button } from '@workspace/ui/components/button';
import { Bell, ChevronsUpDown, Info, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { DriveProjectionView } from '@/app/graph/views/drive';
import { GraphProjectionView } from '@/app/graph/views/graph';
import { buildContainment, LensProjectionView } from '@/app/graph/views/lens';
import { NotionProjectionView } from '@/app/graph/views/notion';
import {
  DEFAULT_KB_VARIANT,
  kbVariantLabel,
  kbVariantNote,
  type KbViewData,
  type KbVariantId,
  type ProjectionViewProps,
} from '@/app/graph/views/registry';
import { ResourcePanel } from '@/app/graph/views/resource-panel';
import { UnknownProjectionView } from '@/app/graph/views/unknown';
import { KbViewSwitcher } from './kb-view-switcher';

/**
 * KbWorkbench — the prototype `app.jsx` shell, the FULL-VIEWPORT oblast over
 * `/author/graph` (slice-11 Ф3 §1, ADR-0014). It is a full-viewport flex COLUMN
 * 1:1 with the prototype `App`: a 56px top bar (brand + space switcher + the
 * CENTERED 4-way variant switcher + search/bell/avatar actions), the explainer
 * strip (VARIANT_NOTE), and a `flex-1 min-h-0` body that hands its whole area to
 * the active view (internal rail/canvas/panel scroll independently). The page
 * segment hands this the entire screen — there is NO centered max-width frame.
 *
 * It holds the cross-view state the prototype `App` holds: the active `variant`
 * (which projection of the ONE graph is shown), the shared `selectedId` (the open
 * node survives a view switch), and the SHARED ResourcePanel (one drawer for all
 * views). It renders the variant switcher + explainer-strip + the active view
 * (resolved from the registry by variant), and the panel.
 *
 * Top-bar MOCKS (no backend yet, explicitly marked, poc-no-fallbacks relaxed only
 * for inert chrome): the brand/logo is a static mark, the space switcher is an
 * inert button (no multi-space picker landed), and search/bell/avatar are inert
 * action affordances. These reproduce the prototype top bar 1:1 so the shell is
 * pixel-complete; each is a clearly-labelled placeholder, not fake behaviour.
 *
 * The four variants are PROJECTIONS over the same resolved dataset (Invariant #1):
 * the server resolves ONCE and threads `result` + `kbData` here; every view reads
 * the same set. The workbench is presentational — it owns view state and wires the
 * shared panel/select/refresh, but never queries Supabase/the resolver. RLS is the
 * sole authority (an ungranted user gets an empty `result` → empty views).
 *
 * Selection is PRESERVED across the live views (drive ⇆ notion ⇆ lens) so the shared
 * panel persists — a small, deliberate refinement of the prototype's reset-on-switch
 * (the prototype reset because each view re-derived its own panel; here the panel
 * is genuinely shared, so keeping the open node is the better UX and the visible
 * proof that it is one graph).
 *
 * The shared drawer is SUPPRESSED for the `notion` variant (prototype 1:1: the
 * panel is not shown in Notion — `variant !== "notion"`; description/health are
 * embedded in the reading canvas instead). Selecting a node in Notion just opens
 * that page in the canvas; switching back to drive/lens re-opens the drawer on the
 * same selection. The `graph` variant DOES carry the shared drawer (prototype shows
 * the panel for it, `variant !== "notion"`): selecting a neighbour both RE-CENTERS
 * the map and opens the drawer on it — the visible proof that the spatial map and
 * the panel read the one graph. ALL FOUR variants are now live (final view, Ф5).
 */

export type KbWorkbenchProps = {
  result: ProjectionResult;
  messages: Record<string, string>;
  spaceId: string;
  kbData: KbViewData;
};

export function KbWorkbench({
  result,
  messages,
  spaceId,
  kbData,
}: KbWorkbenchProps) {
  const router = useRouter();
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const [variant, setVariant] = React.useState<KbVariantId>(DEFAULT_KB_VARIANT);
  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    undefined
  );
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const containment = React.useMemo(
    () => buildContainment(result.items, kbData.containment),
    [result.items, kbData.containment]
  );

  // Selecting a node sets the shared selection and (for the drawer-bearing views)
  // opens the panel. In Notion the panel is suppressed (canvas-embedded, 1:1), so
  // selection only re-routes the open page in the canvas — never the drawer.
  const select = React.useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      setPanelOpen(variant !== 'notion');
    },
    [variant]
  );

  const onMutated = React.useCallback(() => {
    setRefreshKey((value) => value + 1);
    router.refresh();
  }, [router]);

  // Switching INTO Notion closes the drawer (Notion has no panel, 1:1); the shared
  // selection is preserved so the same node opens in the canvas, and switching back
  // re-opens the drawer on it.
  const onVariant = React.useCallback((next: KbVariantId) => {
    setVariant(next);
    if (next === 'notion') {
      setPanelOpen(false);
    }
  }, []);

  // Dispatch by variant with STATIC JSX (not a `<Capitalized/>` local from the
  // registry — that is flagged as "component created during render", and calling a
  // hook-bearing view as a plain function would break the rules of hooks). Each
  // view is a real component element; switching variant unmounts one and mounts the
  // next (its own hook tree). drive/notion/lens are live; graph lands later, so it
  // falls through to the Unknown panel here (its switcher tab is disabled anyway).
  const viewProps: ProjectionViewProps = {
    result,
    messages,
    spaceId,
    kbData,
    selectedId,
    onSelect: select,
    onMutated,
    refreshKey,
  };
  const viewContent =
    variant === 'drive' ? (
      <DriveProjectionView {...viewProps} />
    ) : variant === 'notion' ? (
      <NotionProjectionView {...viewProps} />
    ) : variant === 'lens' ? (
      <LensProjectionView {...viewProps} />
    ) : variant === 'graph' ? (
      <GraphProjectionView {...viewProps} />
    ) : (
      <UnknownProjectionView {...viewProps} />
    );

  const selectedNode = React.useMemo(() => {
    const item = result.items.find((i) => i.id === selectedId);
    return item
      ? {
          id: item.id,
          title: item.title,
          kind: item.kind,
          status: item.status,
        }
      : null;
  }, [result.items, selectedId]);

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
      {/* top bar (prototype `app.jsx` header, 56px, pixel-1:1) */}
      <header className="flex h-14 shrink-0 items-center gap-[14px] border-b px-4">
        {/* brand mark (MOCK: static logo mark — no brand asset pipeline yet) */}
        <div className="flex items-center gap-[9px]">
          <span
            aria-hidden
            className="bg-primary text-primary-foreground grid size-[26px] place-items-center rounded-md text-xs font-bold"
          >
            P
          </span>
          <span className="text-base font-bold tracking-tight">
            {t('graph.topbar.brand')}
          </span>
        </div>

        {/* space switcher (MOCK: inert — no multi-space picker landed yet) */}
        <button
          type="button"
          disabled
          aria-label={t('graph.topbar.space')}
          className="bg-card flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-[5px] text-sm whitespace-nowrap opacity-90"
        >
          <span className="bg-primary text-primary-foreground grid size-[18px] place-items-center rounded-[5px] text-[10px] font-bold">
            A
          </span>
          {t('graph.topbar.space')}
          <ChevronsUpDown
            className="text-muted-foreground size-3.5"
            aria-hidden
          />
        </button>

        {/* variant switcher (the comparison control — centered, prototype 1:1) */}
        <div className="mx-auto">
          <KbViewSwitcher t={t} active={variant} onChange={onVariant} />
        </div>

        {/* actions (MOCK: search/bell inert; avatar a static fallback — no
            search index, notifications feed, or account menu landed here yet) */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label={t('graph.topbar.search')}
          >
            <Search className="size-[17px]" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label={t('graph.topbar.notifications')}
          >
            <Bell className="size-[17px]" aria-hidden />
          </Button>
          <Avatar aria-label={t('graph.topbar.account')}>
            <AvatarFallback>MR</AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* variant explainer strip (prototype VARIANT_NOTE) */}
      <div className="bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-2 border-b px-[18px] py-2 text-[13px]">
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span>
          <strong className="text-foreground font-semibold">
            {kbVariantLabel(t, variant)}:
          </strong>{' '}
          {kbVariantNote(t, variant)}
        </span>
      </div>

      {/* body: the active projection fills the whole remaining area; the view's
          own rail/canvas scroll independently (`flex-1 min-h-0`). */}
      <div className="flex min-h-0 flex-1 overflow-hidden">{viewContent}</div>

      {/* shared detail drawer (one panel for every view EXCEPT Notion, whose
          description/health are embedded in the reading canvas — prototype 1:1). */}
      {variant === 'notion' ? null : (
        <ResourcePanel
          spaceId={spaceId}
          t={t}
          node={selectedNode}
          attributes={
            selectedId ? kbData.attributesByItem[selectedId] : undefined
          }
          health={selectedId ? kbData.healthByItem[selectedId] : undefined}
          meta={selectedId ? kbData.metaByItem[selectedId] : undefined}
          currentUserId={kbData.currentUserId}
          containment={containment}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          onSelect={select}
          onMutated={onMutated}
          tagsByItem={kbData.tagsByItem}
        />
      )}
    </div>
  );
}
