import { loadGraphMessages } from '@workspace/i18n-catalogs/graph';
import type { ProjectionResult } from '@workspace/knowledge-contracts';

import { DriveWorkbench } from './drive-workbench.client';
import {
  DEFAULT_LENS_PROJECTION_ID,
  loadContainmentForest,
  loadKbAttributesForItems,
  loadNodeMetaForItems,
  loadOpenedAtForItems,
  loadShortcutForest,
  loadStarredIds,
  resolveActiveSpaceId,
  resolveCurrentUserId,
  resolveDefaultLensProjection,
  resolveDriveLayout,
  resolveSpaceCapabilities,
} from './graph-page.data';
import type {
  DriveScope,
  KbViewData,
} from './views/registry/projection-view.types';

/**
 * `/author/graph` — the knowledge workbench entry. Resolves the default lens
 * projection over the active space under the user's RLS (ADR-0009 transport, never
 * service-role) and threads it + the KB seed (containment / shortcut forests + node
 * meta + current user id) into the Drive shell. An ungranted user — or no active
 * space — resolves to an empty editor, never an error. RLS/auth is handled upstream
 * by the proxy. (KB satellite attributes — media/link — land in a later pass; until
 * then `attributesByItem` is empty and the meta line falls to "{kind} · {owner}".)
 */
export const dynamic = 'force-dynamic';

/**
 * Read the navigation location from the URL SERVER-SIDE and hand it to the
 * workbench as the INITIAL state. The workbench then owns it in client state +
 * mirrors it back to the URL (`?folder=&doc=&scope=`) — so the location survives
 * refresh, is shareable, and (crucially) the SSR'd HTML already reflects it, which
 * keeps hydration from mismatching the client's first render.
 */
function readLocation(sp: Record<string, string | string[] | undefined>): {
  folder: string | null;
  doc: string | null;
  scope: DriveScope;
} {
  const one = (v: string | string[] | undefined): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  const scope = sp.scope;
  return {
    folder: one(sp.folder),
    doc: one(sp.doc),
    scope:
      scope === 'home' ||
      scope === 'starred' ||
      scope === 'recent' ||
      scope === 'shared' ||
      scope === 'trash'
        ? scope
        : 'kb',
  };
}

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const messages = await loadGraphMessages('en');
  const spaceId = await resolveActiveSpaceId();
  const location = readLocation(await searchParams);
  const initialLayout = await resolveDriveLayout();

  const emptyResult: ProjectionResult = {
    projection_id: DEFAULT_LENS_PROJECTION_ID,
    view: 'lens',
    items: [],
  };

  if (!spaceId) {
    const emptyKb: KbViewData = {
      attributesByItem: {},
      metaByItem: {},
      containment: [],
      shortcuts: [],
      currentUserId: null,
      capabilities: {
        canUpdate: false,
        canDelete: false,
        canCreate: false,
        canAccess: false,
      },
      starredIds: [],
      openedAtById: {},
      trash: { items: [], metaByItem: {} },
    };
    return (
      <DriveWorkbench
        messages={messages}
        result={emptyResult}
        kbData={emptyKb}
        initialFolder={location.folder}
        initialDoc={location.doc}
        initialScope={location.scope}
        initialLayout={initialLayout}
      />
    );
  }

  // The LIVE lens (deleted_at IS NULL) and the TRASH lens (deleted_at IS NOT NULL)
  // are resolved by the SAME machinery (ADR-0018 fork #4), both server-side under
  // the user's RLS. The trash set rides alongside the live canvas as the seed for
  // the client-side 'trash' scope switch — the same shape as Starred/Recent flat
  // lenses over the live canvas. An ungranted/empty Trash resolves to items=[].
  const [result, trashResult] = await Promise.all([
    resolveDefaultLensProjection(spaceId),
    resolveDefaultLensProjection(spaceId, 'trashed'),
  ]);
  const itemIds = result.items.map((item) => item.id);
  const trashIds = trashResult.items.map((item) => item.id);
  const [
    containment,
    shortcuts,
    attributesByItem,
    metaByItem,
    currentUserId,
    starredIds,
    openedAtById,
    trashMetaByItem,
    capabilities,
  ] = await Promise.all([
    loadContainmentForest(spaceId),
    loadShortcutForest(spaceId),
    loadKbAttributesForItems(spaceId, itemIds),
    loadNodeMetaForItems(spaceId, itemIds),
    resolveCurrentUserId(),
    loadStarredIds(spaceId),
    loadOpenedAtForItems(spaceId),
    loadNodeMetaForItems(spaceId, trashIds),
    resolveSpaceCapabilities(spaceId),
  ]);

  const kbData: KbViewData = {
    attributesByItem,
    metaByItem,
    containment,
    shortcuts,
    currentUserId,
    capabilities,
    starredIds,
    openedAtById,
    trash: {
      items: trashResult.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
      })),
      metaByItem: trashMetaByItem,
    },
  };

  return (
    <DriveWorkbench
      messages={messages}
      spaceId={spaceId}
      result={result}
      kbData={kbData}
      initialFolder={location.folder}
      initialDoc={location.doc}
      initialScope={location.scope}
      initialLayout={initialLayout}
    />
  );
}
