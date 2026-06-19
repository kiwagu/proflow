import { describe, expect, it } from 'vitest';

import {
  PROJECTION_VIEW_REGISTRY,
  resolveProjectionView,
} from '@/app/graph/views/view-registry';

/**
 * View-registry contract (slice-11 / ADR-0014 §3): the renderer is chosen ONLY by
 * the variant/`view` key. The product is a MULTI-VIEW knowledge base — four
 * projections over ONE graph. As of Ф5 ALL FOUR are LIVE: `drive` (default) +
 * `notion` + `lens` + `graph`. A key whose component does NOT exist (the retired
 * grid/course/board, ADR-0012 §2, or any typo) degrades to the graceful "not
 * supported" fallback, never a crash. This is Invariant #1 in the presentation
 * layer — proven without graph data because views are pure.
 */
describe('projection view registry', () => {
  it('exposes ALL FOUR live product views (drive default + notion + lens + graph)', () => {
    expect(Object.keys(PROJECTION_VIEW_REGISTRY).sort()).toEqual([
      'drive',
      'graph',
      'lens',
      'notion',
    ]);
    expect(resolveProjectionView('drive')).toBe(PROJECTION_VIEW_REGISTRY.drive);
    expect(resolveProjectionView('notion')).toBe(
      PROJECTION_VIEW_REGISTRY.notion
    );
    expect(resolveProjectionView('lens')).toBe(PROJECTION_VIEW_REGISTRY.lens);
    expect(resolveProjectionView('graph')).toBe(PROJECTION_VIEW_REGISTRY.graph);
  });

  it('degrades a retired or unknown view key to the graceful fallback', () => {
    const fallback = resolveProjectionView('does-not-exist-yet');
    expect(typeof fallback).toBe('function');
    // The fallback is NOT one of the four live renderers — it is the graceful
    // "not supported" panel.
    expect(fallback).not.toBe(resolveProjectionView('drive'));
    expect(fallback).not.toBe(resolveProjectionView('notion'));
    expect(fallback).not.toBe(resolveProjectionView('lens'));
    expect(fallback).not.toBe(resolveProjectionView('graph'));
    // Retired grid/course/board degrade (their components were removed).
    expect(resolveProjectionView('grid')).toBe(fallback);
    expect(resolveProjectionView('course')).toBe(fallback);
    expect(resolveProjectionView('board')).toBe(fallback);
    // Stable: the same unknown key always resolves to the same fallback.
    expect(resolveProjectionView('another-unknown')).toBe(fallback);
  });
});
