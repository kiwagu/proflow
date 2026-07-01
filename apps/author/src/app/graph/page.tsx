import { loadGraphMessages } from '@workspace/i18n-catalogs/graph';
import type { ProjectionResult } from '@workspace/knowledge-contracts';

import { DriveWorkbench } from './drive-workbench';
import {
  DEFAULT_LENS_PROJECTION_ID,
  loadContainmentForest,
  loadKbAttributesForItems,
  loadNodeMetaForItems,
  loadOpenedAtForItems,
  loadShareMechanism,
  loadSharedByMe,
  loadShortcutForest,
  loadStarredIds,
  resolveActiveSpaceId,
  resolveCurrentUserId,
  resolveDefaultLensProjection,
  resolveDriveLayout,
  resolveLensView,
  resolveSpaceCapabilities,
  resolveSpaceEntitlements,
} from './graph-page.data';
import type {
  DriveScope,
  KbViewData,
  LensView,
} from './views/registry/projection-view.types';

/**
 * `/author/graph` — the knowledge workbench entry. Resolves the default lens
 * projection over the active space under the user's RLS (ADR-0009 transport, never
 * service-role) and threads it + the KB seed (containment / shortcut forests + node
 * meta + current user id) into the Drive shell. An ungranted user — or no active
 * space — resolves to an empty editor, never an error. RLS/auth is handled upstream
 * by the proxy. KB satellite attributes ride in `attributesByItem`: `description`
 * and `media` (ADR-0026 — a node's real file bytes surface as size/mime/filename +
 * a Download in the ResourcePanel); a node with no satellite row carries no
 * attribute and the meta line falls to "{kind} · {owner}".
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
  searchTerm: string;
  requestedView: LensView | null;
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
      scope === 'shared-by-me' ||
      scope === 'trash' ||
      scope === 'search'
        ? scope
        : 'kb',
    // The lexical-search term (ADR-0024 §5) — read server-side so a deep-linked
    // `?scope=search&q=<term>` SSRs with its term (no hydration flip). Empty unless
    // the search lens is the active scope.
    searchTerm: one(sp.q) ?? '',
    // The EXPLICITLY-REQUESTED lens display mode (ADR-0022 + Addendum A). `null` = `?view=`
    // absent → fall back to the persisted cookie (Fork 4 amended). An explicit `?view=`
    // WINS over the cookie (a shareable deep-link override). The entitlement clamps the
    // final effective mode below, so a hand-edited `?view=advanced` on a locked plan
    // still renders flat.
    requestedView:
      sp.view === 'advanced' ? 'advanced' : sp.view === 'flat' ? 'flat' : null,
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
  // The persisted Shared-lens display mode (ADR-0022 amended Fork 4). Precedence on
  // initial render: an explicit `?view=` WINS (a shareable deep-link); else the
  // remembered cookie; else 'flat'. The entitlement clamps the final mode below.
  const persistedLensView = await resolveLensView();
  const requestedLensView: LensView =
    location.requestedView ?? persistedLensView;

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
      // No active space → the cheapest plan (ADR-0022): the advanced Shared view is
      // off, so the toggle (which never shows without a space anyway) would lock.
      entitlements: { advancedStructuralView: false },
      starredIds: [],
      openedAtById: {},
      trash: { items: [], metaByItem: {} },
      sharedByMe: [],
      shareMechanism: {},
    };
    return (
      <DriveWorkbench
        messages={messages}
        result={emptyResult}
        kbData={emptyKb}
        initialFolder={location.folder}
        initialDoc={location.doc}
        initialScope={location.scope}
        initialSearchTerm={location.searchTerm}
        initialLensView="flat"
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
    sharedByMe,
    entitlements,
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
    loadSharedByMe(spaceId),
    // The COMMERCIAL entitlement (ADR-0022) — resolved under the SAME RLS client as
    // the verb capabilities, but from a DIFFERENT authority (the platform plan
    // registry, not RLS). Kept ORTHOGONAL: packed as a SIBLING of `capabilities`.
    resolveSpaceEntitlements(spaceId),
  ]);

  // The "Shared with me" set = visible nodes I do NOT own (the same predicate the
  // `'shared'` lens filters to, drive-projection.view.tsx). Computed server-side from
  // the resolved meta + the current user id, so the Part C annotation runs over the
  // PRECISE shared subset (smaller than the whole canvas). When the owner is unknown
  // (no meta) the node is conservatively treated as not-mine and annotated — the
  // annotation never decides visibility, so this only affects which badge shows.
  const sharedNodeIds = currentUserId
    ? itemIds.filter((id) => metaByItem[id]?.ownerUserId !== currentUserId)
    : itemIds;
  const shareMechanism = await loadShareMechanism(spaceId, sharedNodeIds);

  // The EFFECTIVE lens display mode (ADR-0022 amended Fork 4 + Addendum A): the server clamps
  // the REQUESTED mode (explicit `?view=` ELSE the persisted cookie ELSE 'flat') to
  // 'flat' unless the space is entitled, so a hand-edited `?view=advanced` OR a stale
  // 'advanced' cookie on a locked plan still renders flat (the gate is honest without
  // being a security boundary — the same RLS-visible set renders either way). SSR-stable:
  // the workbench seeds its state from this, so the first client render agrees.
  const effectiveLensView: LensView = entitlements.advancedStructuralView
    ? requestedLensView
    : 'flat';

  const kbData: KbViewData = {
    attributesByItem,
    metaByItem,
    containment,
    shortcuts,
    currentUserId,
    capabilities,
    entitlements,
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
    sharedByMe,
    shareMechanism,
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
      initialSearchTerm={location.searchTerm}
      initialLensView={effectiveLensView}
      initialLayout={initialLayout}
    />
  );
}
