import { describe, expect, it } from 'vitest';

import {
  PROJECTION_VIEW_REGISTRY,
  resolveProjectionView,
} from '@/app/graph/views/view-registry';

/**
 * View-registry contract (slice-04 §2 / §7.4): the renderer is chosen ONLY by
 * the resolved `view` key. A new view is one new entry + one component; an
 * unknown key degrades to a single graceful fallback, never a crash. This is
 * Invariant #1 in the presentation layer — proven without any graph data because
 * the views are purely presentational.
 */
describe('projection view registry', () => {
  it('maps the POC views grid + course to distinct renderers', () => {
    expect(Object.keys(PROJECTION_VIEW_REGISTRY).sort()).toEqual([
      'course',
      'grid',
    ]);
    expect(resolveProjectionView('grid')).toBe(PROJECTION_VIEW_REGISTRY.grid);
    expect(resolveProjectionView('course')).toBe(
      PROJECTION_VIEW_REGISTRY.course
    );
    expect(resolveProjectionView('grid')).not.toBe(
      resolveProjectionView('course')
    );
  });

  it('degrades an unknown view key to the fallback, not the known renderers', () => {
    const fallback = resolveProjectionView('does-not-exist-yet');
    expect(typeof fallback).toBe('function');
    expect(fallback).not.toBe(resolveProjectionView('grid'));
    expect(fallback).not.toBe(resolveProjectionView('course'));
    // Stable: the same unknown key always resolves to the same fallback.
    expect(resolveProjectionView('another-unknown')).toBe(fallback);
  });
});
