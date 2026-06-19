import type { ProjectionResult } from '@workspace/knowledge-contracts';
import type { GatedSequence, GatingResult } from '@workspace/knowledge-engine';
import type { ReactNode } from 'react';

import type {
  ContainmentEdge,
  KbAttributes,
  NodeHealth,
  NodeMeta,
  ResourceTag,
  ShortcutEdge,
} from '@/app/graph/graph-page.data';
import { DriveProjectionView } from '../drive';
import { GraphProjectionView } from '../graph';
import { LensProjectionView } from '../lens';
import { NotionProjectionView } from '../notion';
import { UnknownProjectionView } from '../unknown';

/**
 * View registry — keyed by `view_types.key`. One resolved dataset, many
 * presentations: a new application view = ONE new component + ONE new entry here,
 * with ZERO changes to the data model, resolver, contract or RLS. This is
 * Invariant #1 made visible in the presentation layer (docs/knowledge-graph-plan.md
 * §6, ADR-0003 / ADR-0014 §3).
 *
 * The product is a MULTI-VIEW knowledge base (ADR-0014): four projections over the
 * SAME graph — `drive` (folder tree, the default), `notion` (nested pages + inline
 * mentions + backlinks), `lens` (graph-native rail + facets), and `graph` (spatial
 * focus+neighborhood ego map). ALL FOUR are LIVE here. The
 * retired grid/course/board (ADR-0012 §2) are NOT these and do not return here.
 * The `UnknownProjectionView` fallback degrades any unknown key gracefully.
 *
 * View components are PURELY presentational: their only inputs are the already-
 * resolved `ProjectionResult` (RLS already narrowed it) and the i18n message
 * catalog (a plain serializable object — NOT the `t` function, which cannot cross
 * the RSC boundary into the client lens view; each view rebuilds its own
 * translator via `createGraphTranslator`). They never touch Supabase/Payload/the
 * resolver — resolution happens server-side (§4). That guardrail keeps a future
 * extraction into a shared package a reskin.
 */

/**
 * Server-loaded KB seed (slice-11 Ф2 §7 / Ф3): every RLS-scoped fan-out alongside
 * the resolved canvas — the containment forest (folder tree / breadcrumb / counts
 * via FORWARD `contains`), the shortcut forest (Drive cross-folder symlinks,
 * FORWARD `shortcut`), the per-item tag map, the KB satellite attributes
 * (description/provenance/link/media/views), node meta (owner/updated), DERIVED
 * health (orphan/stale), and the current user id (owner "You" label only). Shared
 * by ALL views (the four projections read the SAME graph) — the workbench loads it
 * once and threads it; a view stays presentational (consumes the seed + pulls the
 * panel/rail neighborhood through the route, never queries Supabase/the resolver
 * itself — ADR-0005 guardrail b).
 */
export type KbViewData = {
  tagsByItem: Record<string, ResourceTag[]>;
  attributesByItem: Record<string, KbAttributes>;
  metaByItem: Record<string, NodeMeta>;
  healthByItem: Record<string, NodeHealth>;
  containment: ContainmentEdge[];
  shortcuts: ShortcutEdge[];
  currentUserId: string | null;
};

export type ProjectionViewProps = {
  result: ProjectionResult;
  /** Plain serializable message catalog (RSC-safe); the view builds its own `t`. */
  messages: Record<string, string>;
  /**
   * The currently selected node id (shared across views — open node survives a
   * switch, prototype `app.jsx`). The view highlights it; the workbench owns it.
   */
  selectedId?: string;
  /** Select a node → opens the SHARED ResourcePanel (owned by the workbench). */
  onSelect: (nodeId: string) => void;
  /** Bumped by the workbench after a mutation so views drop stale lazy children. */
  refreshKey: number;
  /** Re-run the server resolve after a mutation (the workbench refreshes). */
  onMutated: () => void;
  /**
   * Per-user display gating computed server-side (slice-05 §4.4). DORMANT in the
   * product surface (the course view was retired, ADR-0012 §2): no current view
   * consumes it. Kept optional so course returns as one entry + one component
   * with zero changes — Invariant #1. A view that consumes it stays presentational
   * (it never fetches state or calls `gateSequence` itself).
   */
  gating?: GatedSequence;
  /**
   * Per-node display gating computed server-side (slice-06 §4.2). DORMANT
   * alongside `gating` (the board view was retired, ADR-0012 §2). Kept optional so
   * board returns cheaply. A consuming view stays presentational (it consumes the
   * already-computed verdicts, never fetches state or runs a rule — ADR-0005 §b).
   */
  nodeGates?: GatingResult;
  /**
   * Active space id — the lens view's write target (authoring POSTs carry
   * `{ spaceId, … }`). The result contract intentionally does not echo
   * `space_id`, so the page threads it here.
   */
  spaceId?: string;
  /**
   * Server-loaded lens seed data (slice-11 Ф2 §7). Passed for the `lens` view,
   * all RLS-scoped fan-outs alongside the resolved canvas: the containment forest
   * (folder tree / breadcrumb / counts via FORWARD `contains`), the per-item tag
   * map, the KB satellite attributes (description/provenance/link/media/views),
   * node meta (owner/updated), DERIVED health (orphan/stale), and the current
   * user id (owner "You" label only). The view stays presentational: it consumes
   * this seed + pulls the panel/rail neighborhood through the route, and never
   * queries Supabase/the resolver itself (ADR-0005 guardrail b).
   */
  kbData?: KbViewData;
};

export type ProjectionView = (props: ProjectionViewProps) => ReactNode;

// view-key → renderer. ALL FOUR live: `drive` (default) + `notion` + `lens` +
// `graph` — each one entry + one component, zero model/resolver/contract changes
// (ADR-0014 §3, Invariant #1).
export const PROJECTION_VIEW_REGISTRY: Record<string, ProjectionView> = {
  drive: DriveProjectionView,
  notion: NotionProjectionView,
  lens: LensProjectionView,
  graph: GraphProjectionView,
};

/**
 * Resolve the renderer for a view key. An unknown key (the data carries a view
 * whose component has not landed yet — e.g. a forgotten course/board projection)
 * degrades to an explicit "not supported" panel — graceful, never a crash.
 */
export function resolveProjectionView(view: string): ProjectionView {
  return PROJECTION_VIEW_REGISTRY[view] ?? UnknownProjectionView;
}
