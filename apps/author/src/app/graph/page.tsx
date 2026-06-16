import { redirect } from 'next/navigation';

import {
  listSpaceProjections,
  loadGraphTranslator,
  resolveActiveSpaceId,
} from './graph-page.data';

/**
 * `/author/graph` index. Loads the active space's saved projections under the
 * user's RLS client and redirects to the first one (the default rendered app).
 * Auth is handled upstream: a guest is redirected to platform sign-in by the
 * proxy before this renders (§5). RLS is the access authority — an ungranted
 * user gets an empty projection list and lands on the empty-state below.
 */
export const dynamic = 'force-dynamic';

export default async function GraphIndexPage() {
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

  if (projections.length > 0) {
    redirect(`/graph/${projections[0]!.id}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="font-heading text-2xl">{t('graph.page.title')}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {t('graph.switcher.empty')}
      </p>
    </div>
  );
}
