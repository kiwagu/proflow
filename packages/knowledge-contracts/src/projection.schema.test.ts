import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  PROJECTION_SPEC_SCHEMA_VERSION,
  parseProjectionSpec,
  projectionSpecSchema,
} from './projection.schema.js';

type ProjectionSpecInput = z.input<typeof projectionSpecSchema>;

/**
 * The two seed projections (knowledge base + course) sit over the SAME graph
 * tables and the SAME vocabularies. These objects are the exact jsonb the seed
 * migration writes into `public.projections.spec`; parsing them here keeps the
 * stored data and the contract in lock-step (Invariant #1: a second app type is
 * one more parse-valid row, never a schema change).
 */

// Variant B: the tag is a graph node and "has tag" is a traversal over `tagged`
// edges (incoming from the tag node), NOT a `tag` filter leaf. The projection
// filter is scalar-only (real node columns).
const knowledgeBaseSpec = {
  schema_version: 1,
  filter: { field: 'kind', op: 'in', value: ['text', 'link'] },
  traversal: {
    // start = the tag node(s); the live seed/e2e uses start.ids = [<tag knr_>].
    start: {
      filter: { field: 'kind', op: 'eq', value: 'tag' },
    },
    relation_types: ['tagged'],
    direction: 'incoming',
    max_depth: 1,
    order_by: 'position',
  },
  view: 'grid',
} as const;

const courseSpec = {
  schema_version: 1,
  filter: { field: 'status', op: 'eq', value: 'active' },
  traversal: {
    start: {
      filter: { field: 'kind', op: 'eq', value: 'text' },
    },
    relation_types: ['prerequisite'],
    direction: 'outgoing',
    max_depth: 16,
    order_by: 'position',
  },
  view: 'course',
} as const;

describe('projectionSpecSchema', () => {
  it('round-trips the knowledge_base seed projection', () => {
    const parsed = projectionSpecSchema.parse(knowledgeBaseSpec);
    expect(parsed).toEqual(knowledgeBaseSpec);
    expect(parsed.view).toBe('grid');
    expect(parsed.traversal.relation_types).toEqual(['tagged']);
    expect(parsed.traversal.direction).toBe('incoming');
  });

  it('round-trips the course seed projection', () => {
    const parsed = projectionSpecSchema.parse(courseSpec);
    expect(parsed).toEqual(courseSpec);
    expect(parsed.view).toBe('course');
    expect(parsed.traversal.relation_types).toEqual(['prerequisite']);
    expect(parsed.traversal.max_depth).toBe(16);
  });

  it('exposes the pinned schema version', () => {
    expect(PROJECTION_SPEC_SCHEMA_VERSION).toBe(1);
    expect(courseSpec.schema_version).toBe(PROJECTION_SPEC_SCHEMA_VERSION);
  });

  it('parses a nested boolean filter AST', () => {
    const spec: ProjectionSpecInput = {
      schema_version: 1,
      filter: {
        or: [
          { field: 'status', op: 'eq', value: 'active' },
          { not: { field: 'visibility', op: 'eq', value: 'private' } },
        ],
      },
      traversal: { start: {}, relation_types: [] },
      view: 'list',
    };
    const result = parseProjectionSpec(spec);
    expect(result.success).toBe(true);
  });

  it('applies traversal defaults (direction/max_depth/order_by)', () => {
    const parsed = projectionSpecSchema.parse({
      schema_version: 1,
      filter: { field: 'kind', op: 'eq', value: 'text' },
      traversal: { start: {}, relation_types: [] },
      view: 'grid',
    });
    expect(parsed.traversal.direction).toBe('outgoing');
    expect(parsed.traversal.max_depth).toBe(0);
    expect(parsed.traversal.order_by).toBe('position');
  });

  it('rejects an unknown filter field (anti-injection allow-list)', () => {
    const result = parseProjectionSpec({
      schema_version: 1,
      filter: { field: 'space_id', op: 'eq', value: 'spc_x' },
      traversal: { start: {}, relation_types: [] },
      view: 'grid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects the removed `tag` filter field (Variant B: tag is a node, not a field)', () => {
    const result = parseProjectionSpec({
      schema_version: 1,
      filter: { field: 'tag', op: 'eq', value: 'kb' },
      traversal: { start: {}, relation_types: [] },
      view: 'grid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a wrong schema_version', () => {
    const result = parseProjectionSpec({
      ...courseSpec,
      schema_version: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a max_depth above the recursion ceiling', () => {
    const result = parseProjectionSpec({
      schema_version: 1,
      filter: { field: 'kind', op: 'eq', value: 'text' },
      traversal: {
        start: {},
        relation_types: ['prerequisite'],
        max_depth: 17,
      },
      view: 'course',
    });
    expect(result.success).toBe(false);
  });
});
