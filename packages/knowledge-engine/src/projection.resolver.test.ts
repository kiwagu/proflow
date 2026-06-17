import type { ProjectionSpec } from '@workspace/knowledge-contracts';
import { projectionSpecSchema } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { compileProjectionQuery } from './projection.resolver.js';

function parse(raw: unknown): ProjectionSpec {
  return projectionSpecSchema.parse(raw);
}

// The two real seed specs (Variant B), kept in lock-step with the contract and
// the e2e harness. Composing them must produce parameterized SQL with no value
// interpolation.
const kbSpec = parse({
  schema_version: 1,
  filter: { field: 'kind', op: 'in', value: ['text', 'link'] },
  traversal: {
    start: { ids: ['knr_tag_kb'] },
    relation_types: ['tagged'],
    direction: 'incoming',
    max_depth: 1,
    order_by: 'position',
  },
  view: 'grid',
});

const courseSpec = parse({
  schema_version: 1,
  filter: { field: 'status', op: 'eq', value: 'active' },
  traversal: {
    start: { filter: { field: 'kind', op: 'eq', value: 'text' } },
    relation_types: ['prerequisite'],
    direction: 'outgoing',
    max_depth: 16,
    order_by: 'position',
  },
  view: 'course',
});

describe('compileProjectionQuery — real seed specs', () => {
  it('KB spec composes into a recursive-CTE query, params only', () => {
    const { sql, params } = compileProjectionQuery(kbSpec, {
      spaceId: 'spc_1',
    });
    expect(sql).toContain('with recursive');
    expect(sql).toContain('start_nodes as (');
    expect(sql).toContain('join public.knowledge_resources kr');
    // incoming tagged traversal
    expect(sql).toContain('on e.to_id = w.node_id');
    // projection filter `kind in (...)`
    expect(sql).toMatch(/kr\.kind = any\(\$\d+\)/);
    // ZERO value interpolation: no seed value text leaks into the SQL.
    expect(sql).not.toContain('knr_tag_kb');
    expect(sql).not.toContain("'text'");
    expect(sql).not.toContain("'tagged'");
    expect(params).toContain('spc_1');
    expect(params).toContainEqual(['knr_tag_kb']);
    expect(params).toContainEqual(['tagged']);
    expect(params).toContainEqual(['text', 'link']);
  });

  it('course spec composes a prerequisite walk ordered by positions', () => {
    const { sql, params } = compileProjectionQuery(courseSpec, {
      spaceId: 'spc_1',
    });
    expect(sql).toContain('on e.from_id = w.node_id'); // outgoing
    expect(sql).toContain('order by ranked.positions asc');
    expect(sql).toMatch(/kr\.status = \$\d+/); // status filter
    expect(sql).not.toContain("'active'");
    expect(sql).not.toContain("'prerequisite'");
    expect(params).toContain('active');
    expect(params).toContainEqual(['prerequisite']);
  });

  it('placeholder numbering is contiguous across traversal + filter', () => {
    const { sql, params } = compileProjectionQuery(courseSpec, {
      spaceId: 'spc_1',
    });
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const maxPlaceholder = Math.max(...placeholders);
    // every param index 1..N is referenced and N == params.length
    expect(maxPlaceholder).toBe(params.length);
    const referenced = new Set(placeholders);
    for (let i = 1; i <= params.length; i += 1) {
      expect(referenced.has(i)).toBe(true);
    }
  });
});
