import { Skeleton } from '@workspace/ui/components/skeleton';
import { Suspense } from 'react';

import {
  computeNodeHealth,
  loadContainmentForest,
  loadGraphCatalogMessages,
  loadGraphTranslator,
  loadKbAttributesForItems,
  loadNodeMetaForItems,
  loadResourceTagsForItems,
  loadShortcutForest,
  resolveActiveSpaceId,
  resolveCurrentUserId,
  resolveDefaultLensProjection,
} from './graph-page.data';
import { KbWorkbench } from './views/kb-workbench';

/**
 * `/author/graph` — the knowledge-base editor. It opens an EDITOR ALWAYS (rev. 3,
 * ADR-0012 §5): at zero resources and with NO saved projection, it does NOT
 * redirect and does NOT show a dead empty page. It resolves the DEFAULT IMPLICIT
 * lens-spec (built in code, §5.3) under the user's RLS and renders the lens view —
 * an empty graph yields an empty EDITOR with a prominent "New", never a dead page.
 *
 * Auth is handled upstream: a guest is redirected to platform sign-in by the proxy
 * before this renders (§5). RLS is the access authority — an ungranted user
 * resolves to `items=[]` (and empty hubs/tags) and gets the empty editor. A saved
 * lens projection is the special case routed at `/author/graph/[projectionId]`.
 *
 * Resolution is blocking on the server, wrapped in `Suspense` with a skeleton so
 * the first paint never flashes empty (`nextjs-blocking-routes-suspense`).
 */
export const dynamic = 'force-dynamic';

function EditorSkeleton() {
  // Full-bleed skeleton — mirrors the workbench shell: 56px top bar, explainer
  // strip, full-height body (rail + canvas) so the first paint never flashes a
  // centered frame (`nextjs-blocking-routes-suspense`).
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

async function EditorPanel({ spaceId }: { spaceId: string }) {
  const messages = await loadGraphCatalogMessages();
  const result = await resolveDefaultLensProjection(spaceId);
  const itemIds = result.items.map((item) => item.id);

  // KB seed (slice-11 Ф2/Ф3 §7): the containment forest (folder tree + breadcrumb +
  // descendant counts, FORWARD `contains`), the shortcut forest (Drive symlinks,
  // FORWARD `shortcut`), the per-item tag map, the KB satellite attributes
  // (description/provenance/link/media/views), node meta (owner/updated), and
  // DERIVED health (orphan/stale) — all RLS-scoped fan-outs alongside the resolved
  // canvas. SHARED by all four views (one graph, many projections). Each view stays
  // presentational: it consumes this seed + pulls the panel/rail neighborhood
  // through the route, never querying Supabase/the resolver itself (ADR-0005 §b).
  const [
    tagsByItem,
    attributesByItem,
    metaByItem,
    containment,
    shortcuts,
    currentUserId,
  ] = await Promise.all([
    loadResourceTagsForItems(spaceId, itemIds),
    loadKbAttributesForItems(spaceId, itemIds),
    loadNodeMetaForItems(spaceId, itemIds),
    loadContainmentForest(spaceId),
    loadShortcutForest(spaceId),
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
    currentUserId,
  };

  // The workbench (prototype `app.jsx`) renders the variant switcher + the active
  // projection (registry dispatch by variant) + the shared ResourcePanel over the
  // ONE resolved dataset. Default variant = drive (Ф3). Invariant #1: four views,
  // one graph — zero model/resolver/contract changes.
  return (
    <KbWorkbench
      result={result}
      messages={messages}
      spaceId={spaceId}
      kbData={kbData}
    />
  );
}

export default async function GraphIndexPage() {
  const t = await loadGraphTranslator();
  const spaceId = await resolveActiveSpaceId();

  if (!spaceId) {
    return (
      <div className="grid h-dvh place-items-center px-6">
        <p className="text-muted-foreground text-sm">{t('graph.noSpace')}</p>
      </div>
    );
  }

  // Full-bleed: the workbench is the prototype shell and carries its OWN top bar +
  // explainer strip, so the page hands it the whole viewport — no centered
  // max-width frame, no separate header (ADR-0014, slice-11 layout fix).
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditorPanel spaceId={spaceId} />
    </Suspense>
  );
}
