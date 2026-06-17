import { Skeleton } from '@workspace/ui/components/skeleton';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';

import {
  listSpaceProjections,
  loadGraphTranslator,
  resolveActiveSpaceId,
  resolveCourseGating,
  resolveSpaceProjection,
} from '../graph-page.data';
import { ProjectionSwitcher } from '../views/projection-switcher';
import { resolveProjectionView } from '../views/view-registry';

/**
 * `/author/graph/[projectionId]` — resolves ONE saved projection over the graph
 * under the user's RLS client and dispatches to its view via the registry
 * (`resolveProjectionView(result.view)`). The switcher lets the user toggle to
 * another saved projection over the SAME graph (visible Invariant #1, §3.3).
 *
 * Resolution is blocking on the server, wrapped in `Suspense` with a skeleton so
 * navigating between projections never flashes empty
 * (`nextjs-blocking-routes-suspense`). RLS is the access authority — an ungranted
 * user resolves to `items=[]` and the view renders its empty-state (§7).
 */
export const dynamic = 'force-dynamic';

function ProjectionSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
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
  const t = await loadGraphTranslator();
  const result = await resolveSpaceProjection({ spaceId, projectionId });

  if (!result) {
    notFound();
  }

  // Per-user gating is computed ONLY for the course view (gating is course
  // pedagogy); grid/KB resolves PURE as before. The overlay fetch + gateSequence
  // live in a thin helper, keeping resolveSpaceProjection projection-PURE.
  const gating =
    result.view === 'course'
      ? await resolveCourseGating({ spaceId, result })
      : undefined;

  // Registry dispatch: pick the renderer by `result.view` and invoke it directly
  // (it is a presentational function returning ReactNode, not a stateful
  // component instantiated per render). A new view = a new registry entry, zero
  // changes here — Invariant #1 in the presentation layer.
  const renderProjectionView = resolveProjectionView(result.view);
  return <>{renderProjectionView({ result, t, gating, spaceId })}</>;
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
      <div className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-muted-foreground text-sm">{t('graph.noSpace')}</p>
      </div>
    );
  }

  const projections = await listSpaceProjections(spaceId);

  // No readable projection in this space (RLS) → nothing to render; fall back to
  // the index, which shows the empty-state.
  if (projections.length === 0) {
    redirect('/graph');
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl">{t('graph.page.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('graph.page.description')}
          </p>
        </div>
        <ProjectionSwitcher
          projections={projections}
          currentProjectionId={projectionId}
          label={t('graph.switcher.label')}
          placeholder={t('graph.switcher.placeholder')}
        />
      </header>
      <Suspense fallback={<ProjectionSkeleton />}>
        <ProjectionPanel spaceId={spaceId} projectionId={projectionId} />
      </Suspense>
    </div>
  );
}
