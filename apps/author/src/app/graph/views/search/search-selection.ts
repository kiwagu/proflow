import type { ResourceFloor } from '@/app/graph/graph-data.types';

/**
 * The renderable meta a SEARCH hit carries on the wire — the subset of
 * `SearchResultItem` the SHARED ResourcePanel needs to render correct meta when the
 * hit is NOT in the resolved Drive canvas (`kbData`/`result.items`). The workbench
 * keeps these keyed by id and reads them as a FALLBACK so opening a search result
 * (`kind`/`status`/broadcast `visibility`) shows the node's real meta line instead of
 * a bare degraded one — and so the panel opens at all for an out-of-canvas hit (whose
 * `selectedNode` would otherwise resolve to null). `visibility` is the broadcast floor
 * the row already carries; never a fence (RLS already admitted the row to the result).
 */
export type SearchSelection = {
  id: string;
  kind: string;
  title: string;
  status: string;
  visibility: ResourceFloor;
};
