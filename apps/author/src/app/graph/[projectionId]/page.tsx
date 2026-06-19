import { Skeleton } from '@workspace/ui/components/skeleton';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import {
  computeNodeHealth,
  loadAllSpaceTags,
  loadContainmentForest,
  loadGraphCatalogMessages,
  loadGraphTranslator,
  loadKbAttributesForItems,
  loadNodeMetaForItems,
  loadResourceTagsForItems,
  loadShortcutForest,
  resolveActiveSpaceId,
  resolveCurrentUserId,
  resolveSpaceProjection,
} from '../graph-page.data';
import { KbWorkbench } from '../views';

/**
 * `/author/graph/[projectionId]` — resolves ONE saved projection over the graph
 * under the user's RLS client and dispatches to its view via the registry
 * (`resolveProjectionView(result.view)`). This is the special case of a NAMED
 * lens projection (e.g. a tag-rooted slice); the default editor lives at the
 * index `/author/graph` (rev. 3, ADR-0012 §5 — no switcher, one product view).
 *
 * Resolution is blocking on the server, wrapped in `Suspense` with a skeleton so
 * navigation never flashes empty (`nextjs-blocking-routes-suspense`). RLS is the
 * access authority — an ungranted user resolves to a hidden row (`null`) and is
 * redirected to the default editor (§7).
 */
export const dynamic = 'force-dynamic';

function ProjectionSkeleton() {
  // Full-bleed skeleton — same shell as the index: top bar + explainer strip +
  // full-height body, so navigation never flashes a centered frame
  // (`nextjs-blocking-routes-suspense`).
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="size-[26px] rounded-md" />
        <Skeleton className="h-7 w-40 rounded-md" />
        <Skeleton className="mx-auto h-9 w-80 rounded-lg" />
        <Skeleton className="size-8 rounded-full" />
      </div>
      <Skeleton className="h-9 w-full shrink-0 rounded-none" />
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <Skeleton className="hidden w-64 rounded-xl md:block" />
        <Skeleton className="flex-1 rounded-xl" />
      </div>
    </div>
  );
}

async function ProjectionPanel({
  spaceId,
  projectionId,
}: {
  spaceId: string;
  projectionId: string;
}) {
  const messages = await loadGraphCatalogMessages();
  const result = await resolveSpaceProjection({ spaceId, projectionId });

  if (!result) {
    notFound();
  }

  // KB seed (slice-11 Ф2/Ф3 §7): containment + shortcut forests + tags + KB
  // attributes + node meta + DERIVED health + current user id, all RLS-scoped. A
  // saved projection is still the SAME multi-view KB shell over a NARROWED graph —
  // it renders through the workbench (switcher + shared panel), the four views as
  // projections over the saved result. The views stay presentational.
  const itemIds = result.items.map((item) => item.id);
  const [
    tagsByItem,
    attributesByItem,
    metaByItem,
    containment,
    shortcuts,
    allTags,
    currentUserId,
  ] = await Promise.all([
    loadResourceTagsForItems(spaceId, itemIds),
    loadKbAttributesForItems(spaceId, itemIds),
    loadNodeMetaForItems(spaceId, itemIds),
    loadContainmentForest(spaceId),
    loadShortcutForest(spaceId),
    loadAllSpaceTags(spaceId),
    resolveCurrentUserId(),
  ]);
  const healthByItem = await computeNodeHealth(
    spaceId,
    result.items.map((item) => ({ id: item.id, kind: item.kind })),
    metaByItem
  );
  const kbData = {
    tagsByItem,
    attributesByItem,
    metaByItem,
    healthByItem,
    containment,
    shortcuts,
    allTags,
    currentUserId,
  };

  // The workbench renders the variant switcher + active projection + shared panel
  // over the saved result. Invariant #1: four views, one (narrowed) graph.
  return (
    <KbWorkbench
      result={result}
      messages={messages}
      spaceId={spaceId}
      kbData={kbData}
    />
  );
}

export default async function GraphProjectionPage({
  params,
}: {
  params: Promise<{ projectionId: string }>;
}) {
  const { projectionId } = await params;
  const t = await loadGraphTranslator();
  const spaceId = await resolveActiveSpaceId();

  if (!spaceId) {
    return (
      <div className="grid h-dvh place-items-center px-6">
        <p className="text-muted-foreground text-sm">{t('graph.noSpace')}</p>
      </div>
    );
  }

  // Full-bleed: the workbench carries its own top bar + explainer strip, so a
  // saved projection also renders into the whole viewport — no centered frame,
  // no separate header (ADR-0014, slice-11 layout fix).
  return (
    <Suspense fallback={<ProjectionSkeleton />}>
      <ProjectionPanel spaceId={spaceId} projectionId={projectionId} />
    </Suspense>
  );
}
