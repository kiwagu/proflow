import type { NeighborhoodSpec } from '@workspace/knowledge-contracts';
import { neighborhoodSpecSchema } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { compileNeighborhoodQuery } from './neighborhood.resolver.js';

function spec(raw: unknown): NeighborhoodSpec {
  return neighborhoodSpecSchema.parse(raw);
}

describe('compileNeighborhoodQuery — bounded BFS from one center', () => {
  it('depth-1 outgoing: recursive CTE anchored on the center, params only', () => {
    const { sql, params } = compileNeighborhoodQuery(
      spec({
        schema_version: 1,
        relation_types: ['relates_to', 'tagged'],
        direction: 'outgoing',
        max_depth: 1,
      }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    expect(sql).toContain('with recursive');
    expect(sql).toContain('walk as (');
    // outgoing step walks from→to
    expect(sql).toContain('on e.from_id = w.node_id');
    expect(sql).not.toContain('on e.to_id = w.node_id');
    // joins the node columns for the view
    expect(sql).toContain('join public.knowledge_resources kr');
    // ZERO value interpolation: no center/space/relation text leaks into the SQL
    expect(sql).not.toContain('knr_center');
    expect(sql).not.toContain('spc_1');
    expect(sql).not.toContain("'relates_to'");
    expect(sql).not.toContain("'tagged'");
    // the center, space, relation_types are bound params
    expect(params).toContain('knr_center');
    expect(params).toContain('spc_1');
    expect(params).toContainEqual(['relates_to', 'tagged']);
  });

  it('binds the SINGLE center as the recursion anchor (not a filter set)', () => {
    const { sql } = compileNeighborhoodQuery(
      spec({ schema_version: 1, relation_types: ['relates_to'] }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    // anchor seeds the path array with the center param
    expect(sql).toMatch(/array\[\$\d+\]\s+as path/);
    // there is NO filter-derived start_nodes CTE (that is resolveProjection)
    expect(sql).not.toContain('start_nodes');
  });

  it('depth-2: the recursive step is bounded by the max_depth param', () => {
    const { sql, params } = compileNeighborhoodQuery(
      spec({
        schema_version: 1,
        relation_types: ['relates_to'],
        max_depth: 2,
      }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    // depth bound is a param, not an inline number
    expect(sql).toMatch(/where w\.depth < \$\d+/);
    expect(params).toContain(2);
    // only neighbors (depth >= 1) are projected; the center (depth 0) is excluded
    expect(sql).toContain('where w.depth >= 1');
  });

  it('cycle-guard: refuses re-entering a node already on the branch path', () => {
    const { sql } = compileNeighborhoodQuery(
      spec({ schema_version: 1, relation_types: ['relates_to'], max_depth: 2 }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    // parity with traversal.compiler: not (<neighbor> = any(w.path))
    expect(sql).toContain('not ((e.to_id) = any(w.path))');
    expect(sql).toMatch(/w\.path \|\| \(e\.to_id\)/);
  });

  // The historical defect: `both` emitted TWO `union all` branches, each with its
  // own `from walk w` self-reference. Postgres rejects a recursive CTE with more
  // than one self-reference, so the generated SQL was invalid and never executed
  // (the route masked it by stitching two single-direction walks). The correct
  // shape is ONE non-recursive anchor + ONE recursive term that matches BOTH edge
  // sides and derives the neighbor + direction per row.
  it('exactly ONE recursive self-reference, in the recursive term (not the anchor)', () => {
    for (const direction of ['outgoing', 'incoming', 'both'] as const) {
      const { sql } = compileNeighborhoodQuery(
        spec({
          schema_version: 1,
          relation_types: ['relates_to', 'tagged'],
          direction,
          max_depth: 2,
        }),
        { centerId: 'knr_center', spaceId: 'spc_1' }
      );

      // The walk CTE has exactly ONE `union all` (anchor ⊎ single recursive term).
      const unionCount = [...sql.matchAll(/union all/g)].length;
      expect(unionCount).toBe(1);

      // Isolate the recursive CTE body: from `walk as (` up to the start of the
      // final ranking select (which reads the COMPLETED CTE — that `from walk w`
      // is an outer read, not a recursive self-reference Postgres counts).
      const cteStart = sql.indexOf('walk as (');
      const finalSelect = sql.indexOf('\nselect\n', cteStart);
      const cteBody = sql.slice(cteStart, finalSelect);

      // Inside the CTE body: exactly ONE self-reference (`from walk w`), and it
      // sits in the RECURSIVE term — AFTER the single `union all`, never in the
      // (non-recursive) anchor before it.
      const selfRefs = [...cteBody.matchAll(/from walk w\b/g)];
      expect(selfRefs).toHaveLength(1);
      const unionIdx = cteBody.indexOf('union all');
      expect(selfRefs[0]!.index!).toBeGreaterThan(unionIdx);
    }
  });

  it('both: a SINGLE recursive term matches both edge sides, direction per-row', () => {
    const { sql } = compileNeighborhoodQuery(
      spec({
        schema_version: 1,
        relation_types: ['relates_to', 'tagged', 'part_of'],
        direction: 'both',
        max_depth: 1,
      }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    // both sides matched in ONE join predicate (OR), not two separate `on` clauses
    expect(sql).toContain('(e.from_id = w.node_id or e.to_id = w.node_id)');
    // neighbor = opposite end of the edge, computed per-row
    expect(sql).toContain(
      'case when e.from_id = w.node_id then e.to_id else e.from_id end'
    );
    // direction computed per-row (not a fixed literal) for `both`
    expect(sql).toContain(
      "case when e.from_id = w.node_id then 'outgoing' else 'incoming' end"
    );
    // there is exactly ONE space guard now (single recursive term, not two)
    const spaceGuards = [...sql.matchAll(/e\.space_id = \$\d+/g)].length;
    expect(spaceGuards).toBe(1);
  });

  it('incoming: walks to→from (e.g. reading resources from a tag node)', () => {
    const { sql } = compileNeighborhoodQuery(
      spec({
        schema_version: 1,
        relation_types: ['tagged'],
        direction: 'incoming',
      }),
      { centerId: 'knr_tag', spaceId: 'spc_1' }
    );
    expect(sql).toContain('on e.to_id = w.node_id');
    expect(sql).not.toContain('on e.from_id = w.node_id');
  });

  it('limit_per_relation: applied per (depth, relation_type, direction) window', () => {
    const { sql, params } = compileNeighborhoodQuery(
      spec({
        schema_version: 1,
        relation_types: ['relates_to'],
        limit_per_relation: 10,
      }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    expect(sql).toContain('partition by w.depth, w.relation_type, w.direction');
    expect(sql).toMatch(/where ranked\.rn <= \$\d+/);
    expect(params).toContain(10);
  });

  it('space-scoped on the recursive step', () => {
    const { sql } = compileNeighborhoodQuery(
      spec({
        schema_version: 1,
        relation_types: ['relates_to'],
        direction: 'both',
      }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    // the single recursive term carries the same-space guard on every hop
    const spaceGuards = [...sql.matchAll(/e\.space_id = \$\d+/g)].length;
    expect(spaceGuards).toBe(1);
  });

  it('placeholder numbering is contiguous and every param is referenced', () => {
    const { sql, params } = compileNeighborhoodQuery(
      spec({
        schema_version: 1,
        relation_types: ['relates_to', 'tagged'],
        direction: 'both',
        max_depth: 2,
      }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const maxPlaceholder = Math.max(...placeholders);
    expect(maxPlaceholder).toBe(params.length);
    const referenced = new Set(placeholders);
    for (let i = 1; i <= params.length; i += 1) {
      expect(referenced.has(i)).toBe(true);
    }
  });

  it('emits a `with recursive … select` shape (defence-in-depth precondition)', () => {
    const { sql } = compileNeighborhoodQuery(
      spec({ schema_version: 1, relation_types: ['relates_to'] }),
      { centerId: 'knr_center', spaceId: 'spc_1' }
    );
    expect(/^\s*with\s+recursive/i.test(sql)).toBe(true);
    // never a CTE-write
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
  });
});
