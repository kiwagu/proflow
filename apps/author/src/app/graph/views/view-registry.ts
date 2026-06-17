import type { ProjectionResult } from '@workspace/knowledge-contracts';
import type { GatedSequence, GatingResult } from '@workspace/knowledge-engine';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { ReactNode } from 'react';

import { BoardProjectionView } from './board-projection.view';
import { CourseProjectionView } from './course-projection.view';
import { GridProjectionView } from './grid-projection.view';
import { UnknownProjectionView } from './unknown-projection.view';

/**
 * View registry — keyed by `ProjectionResult.view` (echo of `spec.view`). One
 * resolved dataset, many presentations: a new application view = ONE new
 * component + ONE new entry here, with ZERO changes to the data model, resolver,
 * contract or RLS. This is Invariant #1 made visible in the presentation layer
 * (docs/knowledge-graph-plan.md §6, ADR-0003).
 *
 * View components are PURELY presentational: their only inputs are the already-
 * resolved `ProjectionResult` (RLS already narrowed it) and an i18n translator.
 * They never touch Supabase/Payload/the resolver — resolution happens server-side
 * (§4). That guardrail keeps a future extraction into a shared package a reskin.
 */

export type ProjectionViewProps = {
  result: ProjectionResult;
  t: GraphTranslator;
  /**
   * Per-user display gating computed server-side (slice-05 §4.4). Passed ONLY for
   * the `course` view (gating is course pedagogy); other views ignore it. Optional
   * so a new view = one entry here with zero changes — Invariant #1 holds. The
   * view stays purely presentational: it consumes the already-computed
   * `GatedSequence`, it never fetches state or calls `gateSequence` itself.
   */
  gating?: GatedSequence;
  /**
   * Per-node display gating computed server-side (slice-06 §4.2). A SEPARATE,
   * optional prop ALONGSIDE the slice-05 `gating?: GatedSequence` — the `board`
   * view consumes this `GatingResult` (e.g. the `requires_state` rule's per-node
   * verdicts); the course view keeps using `gating` untouched. Optional so a new
   * view = one registry entry with zero changes to the existing paths. The view
   * stays purely presentational: it consumes the already-computed verdicts, it
   * never fetches state or calls a gating rule itself (ADR-0005 guardrail b).
   */
  nodeGates?: GatingResult;
  /**
   * Active space id — the write target for the course mark-complete action
   * (slice-05 §4.3 POSTs `{ spaceId, resourceId, coarseStatus }`). Passed
   * alongside `gating` for the `course` view; other views ignore it. The result
   * contract intentionally does not echo `space_id`, so the page threads it here.
   */
  spaceId?: string;
};

export type ProjectionView = (props: ProjectionViewProps) => ReactNode;

// view-key → renderer. A new view is a new entry here + a new component. Period.
// `list` / `kanban` / `graph` / `tree` are added HERE later, zero model changes.
export const PROJECTION_VIEW_REGISTRY: Record<string, ProjectionView> = {
  grid: GridProjectionView,
  course: CourseProjectionView,
  board: BoardProjectionView,
};

/**
 * Resolve the renderer for a view key. An unknown key (the data carries a view
 * whose component has not landed yet) degrades to an explicit "not supported"
 * panel — graceful, never a crash.
 */
export function resolveProjectionView(view: string): ProjectionView {
  return PROJECTION_VIEW_REGISTRY[view] ?? UnknownProjectionView;
}
