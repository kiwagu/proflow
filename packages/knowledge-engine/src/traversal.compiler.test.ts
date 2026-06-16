import type { TraversalSpec } from '@workspace/knowledge-contracts';
import { traversalSpecSchema } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { compileTraversal } from './traversal.compiler.js';

function spec(raw: unknown): TraversalSpec {
  return traversalSpecSchema.parse(raw);
}

describe('compileTraversal — start set', () => {
  it('start.ids binds an array param, no value interpolation', () => {
    const { sql, params } = compileTraversal(
      spec({ start: { ids: ['knr_a', 'knr_b'] }, relation_types: [] }),
      { spaceId: 'spc_1' }
    );
    expect(sql).toContain('start_nodes as (');
    expect(sql).toMatch(/kr\.id = any\(\$\d+\)/);
    expect(sql).not.toContain('knr_a');
    expect(params).toContain('spc_1');
    expect(params).toContainEqual(['knr_a', 'knr_b']);
  });

  it('start.filter compiles into the start predicate', () => {
    const { sql } = compileTraversal(
      spec({
        start: { filter: { field: 'kind', op: 'eq', value: 'tag' } },
        relation_types: [],
      }),
      { spaceId: 'spc_1' }
    );
    expect(sql).toMatch(/kr\.kind = \$\d+/);
  });

  it('empty start ⇒ predicate is `true`', () => {
    const { sql } = compileTraversal(spec({ start: {}, relation_types: [] }), {
      spaceId: 'spc_1',
    });
    expect(sql).toContain('(true)');
  });
});

describe('compileTraversal — depth & no-traversal', () => {
  it('max_depth 0 ⇒ no recursive step (start set only)', () => {
    const { sql } = compileTraversal(
      spec({ start: {}, relation_types: ['tagged'], max_depth: 0 }),
      { spaceId: 'spc_1' }
    );
    expect(sql).not.toContain('union all');
    expect(sql).toContain('walk as (');
  });

  it('empty relation_types ⇒ no recursive step', () => {
    const { sql } = compileTraversal(
      spec({ start: {}, relation_types: [], max_depth: 5 }),
      { spaceId: 'spc_1' }
    );
    expect(sql).not.toContain('union all');
  });

  it('recursive step carries the depth-cap and cycle-guard', () => {
    const { sql } = compileTraversal(
      spec({
        start: {},
        relation_types: ['prerequisite'],
        direction: 'outgoing',
        max_depth: 16,
      }),
      { spaceId: 'spc_1' }
    );
    expect(sql).toContain('union all');
    expect(sql).toMatch(/where w\.depth < \$\d+/); // depth cap
    expect(sql).toMatch(/not \(e\.to_id = any\(w\.path\)\)/); // cycle guard
  });
});

describe('compileTraversal — direction', () => {
  it('outgoing steps from→to', () => {
    const { sql } = compileTraversal(
      spec({
        start: {},
        relation_types: ['prerequisite'],
        direction: 'outgoing',
        max_depth: 3,
      }),
      { spaceId: 'spc_1' }
    );
    expect(sql).toContain('on e.from_id = w.node_id');
    expect(sql).toContain('w.path || e.to_id');
  });

  it('incoming steps to→from (KB tag traversal)', () => {
    const { sql } = compileTraversal(
      spec({
        start: {},
        relation_types: ['tagged'],
        direction: 'incoming',
        max_depth: 1,
      }),
      { spaceId: 'spc_1' }
    );
    expect(sql).toContain('on e.to_id = w.node_id');
    expect(sql).toContain('w.path || e.from_id');
    expect(sql).toMatch(/not \(e\.from_id = any\(w\.path\)\)/);
  });

  it('relation_types are bound as an array param, never inlined', () => {
    const { sql, params } = compileTraversal(
      spec({
        start: {},
        relation_types: ['prerequisite'],
        direction: 'outgoing',
        max_depth: 2,
      }),
      { spaceId: 'spc_1' }
    );
    expect(sql).toMatch(/e\.relation_type = any\(\$\d+\)/);
    expect(sql).not.toContain("'prerequisite'");
    expect(params).toContainEqual(['prerequisite']);
  });
});
