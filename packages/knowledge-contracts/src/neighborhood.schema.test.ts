import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  NEIGHBORHOOD_SPEC_SCHEMA_VERSION,
  neighborhoodResultSchema,
  neighborhoodSpecSchema,
  parseNeighborhoodSpec,
} from './neighborhood.schema.js';

type NeighborhoodSpecInput = z.input<typeof neighborhoodSpecSchema>;

describe('neighborhoodSpecSchema', () => {
  it('exposes the pinned schema version', () => {
    expect(NEIGHBORHOOD_SPEC_SCHEMA_VERSION).toBe(1);
  });

  it('applies defaults (direction/max_depth/limit_per_relation)', () => {
    const parsed = neighborhoodSpecSchema.parse({
      schema_version: 1,
      relation_types: ['relates_to', 'tagged'],
    });
    expect(parsed.direction).toBe('outgoing');
    expect(parsed.max_depth).toBe(1);
    expect(parsed.limit_per_relation).toBe(50);
  });

  it('round-trips an explicit both/depth-2 spec', () => {
    const spec: NeighborhoodSpecInput = {
      schema_version: 1,
      relation_types: ['relates_to', 'tagged', 'part_of'],
      direction: 'both',
      max_depth: 2,
      limit_per_relation: 25,
    };
    const parsed = neighborhoodSpecSchema.parse(spec);
    expect(parsed).toEqual(spec);
  });

  it('rejects an empty relation_types (degenerate walk)', () => {
    const result = parseNeighborhoodSpec({
      schema_version: 1,
      relation_types: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects max_depth above the product cap of 2', () => {
    const result = parseNeighborhoodSpec({
      schema_version: 1,
      relation_types: ['relates_to'],
      max_depth: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects max_depth below 1', () => {
    const result = parseNeighborhoodSpec({
      schema_version: 1,
      relation_types: ['relates_to'],
      max_depth: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects limit_per_relation above 200', () => {
    const result = parseNeighborhoodSpec({
      schema_version: 1,
      relation_types: ['relates_to'],
      limit_per_relation: 201,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown direction', () => {
    const result = parseNeighborhoodSpec({
      schema_version: 1,
      relation_types: ['relates_to'],
      direction: 'sideways',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a wrong schema_version', () => {
    const result = parseNeighborhoodSpec({
      schema_version: 2,
      relation_types: ['relates_to'],
    });
    expect(result.success).toBe(false);
  });
});

describe('neighborhoodResultSchema', () => {
  it('parses a flat neighbors[] result with depth + direction', () => {
    const result = neighborhoodResultSchema.parse({
      center_id: 'knr_center',
      neighbors: [
        {
          edge_id: 'kne_1',
          relation_type: 'relates_to',
          direction: 'outgoing',
          depth: 1,
          node: {
            id: 'knr_a',
            kind: 'text',
            title: 'A',
            status: 'active',
            visibility: 'private',
            body_ref: null,
          },
          position: 0,
        },
        {
          edge_id: 'kne_2',
          relation_type: 'tagged',
          direction: 'outgoing',
          depth: 1,
          node: {
            id: 'knr_tag',
            kind: 'tag',
            title: 'KB',
            status: 'active',
            visibility: 'private',
            body_ref: { collection: 'bodies', doc_id: 'd1' },
          },
          position: 1,
        },
      ],
    });
    expect(result.neighbors).toHaveLength(2);
    expect(result.neighbors[0]?.depth).toBe(1);
    expect(result.neighbors[1]?.node.body_ref).toEqual({
      collection: 'bodies',
      doc_id: 'd1',
    });
  });

  it('accepts an empty neighborhood (RLS-narrowed to nothing)', () => {
    const result = neighborhoodResultSchema.parse({
      center_id: 'knr_center',
      neighbors: [],
    });
    expect(result.neighbors).toEqual([]);
  });

  it('rejects a neighbor at depth 0 (BFS levels are 1-based)', () => {
    const parsed = neighborhoodResultSchema.safeParse({
      center_id: 'knr_center',
      neighbors: [
        {
          edge_id: 'kne_1',
          relation_type: 'relates_to',
          direction: 'outgoing',
          depth: 0,
          node: {
            id: 'knr_a',
            kind: 'text',
            title: 'A',
            status: 'active',
            visibility: 'private',
            body_ref: null,
          },
          position: 0,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
