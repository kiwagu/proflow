import type { ProjectionResult } from '@workspace/knowledge-contracts';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { ReactNode } from 'react';

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
};

export type ProjectionView = (props: ProjectionViewProps) => ReactNode;

// view-key → renderer. A new view is a new entry here + a new component. Period.
// `list` / `kanban` / `graph` / `tree` are added HERE later, zero model changes.
export const PROJECTION_VIEW_REGISTRY: Record<string, ProjectionView> = {
  grid: GridProjectionView,
  course: CourseProjectionView,
};

/**
 * Resolve the renderer for a view key. An unknown key (the data carries a view
 * whose component has not landed yet) degrades to an explicit "not supported"
 * panel — graceful, never a crash.
 */
export function resolveProjectionView(view: string): ProjectionView {
  return PROJECTION_VIEW_REGISTRY[view] ?? UnknownProjectionView;
}
