import { loadGraphMessages } from '@workspace/i18n-catalogs/graph';
import type { ProjectionResult } from '@workspace/knowledge-contracts';

import { DriveWorkbench } from './drive-workbench.client';
import {
  DEFAULT_LENS_PROJECTION_ID,
  loadContainmentForest,
  loadKbAttributesForItems,
  loadNodeMetaForItems,
  loadShortcutForest,
  resolveActiveSpaceId,
  resolveCurrentUserId,
  resolveDefaultLensProjection,
} from './graph-page.data';
import type { KbViewData } from './views/registry/projection-view.types';

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

export default async function GraphPage() {
  const messages = await loadGraphMessages('en');
  const spaceId = await resolveActiveSpaceId();

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
    };
    return (
      <DriveWorkbench
        messages={messages}
        result={emptyResult}
        kbData={emptyKb}
      />
    );
  }

  const result = await resolveDefaultLensProjection(spaceId);
  const itemIds = result.items.map((item) => item.id);
  const [containment, shortcuts, attributesByItem, metaByItem, currentUserId] =
    await Promise.all([
      loadContainmentForest(spaceId),
      loadShortcutForest(spaceId),
      loadKbAttributesForItems(spaceId, itemIds),
      loadNodeMetaForItems(spaceId, itemIds),
      resolveCurrentUserId(),
    ]);

  const kbData: KbViewData = {
    attributesByItem,
    metaByItem,
    containment,
    shortcuts,
    currentUserId,
  };

  return (
    <DriveWorkbench
      messages={messages}
      spaceId={spaceId}
      result={result}
      kbData={kbData}
    />
  );
}
