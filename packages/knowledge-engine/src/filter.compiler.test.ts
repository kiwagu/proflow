import type { FilterNode } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { compileFilter, createCompileCtx } from './filter.compiler.js';

function compile(node: FilterNode) {
  return compileFilter(node, createCompileCtx('kr'));
}

describe('compileFilter — allow-listed field × op round-trips', () => {
  it('eq → `= $n` with the value only in params', () => {
    const { sql, params } = compile({
      field: 'kind',
      op: 'eq',
      value: 'text',
    });
    expect(sql).toBe('(kr.kind = $1)');
    expect(params).toEqual(['text']);
  });

  it('neq → `is distinct from $n`', () => {
    const { sql, params } = compile({
      field: 'visibility',
      op: 'neq',
      value: 'private',
    });
    expect(sql).toBe('(kr.visibility is distinct from $1)');
    expect(params).toEqual(['private']);
  });

  it('in → `= any($n)` with an array param (never inlined list)', () => {
    const { sql, params } = compile({
      field: 'kind',
      op: 'in',
      value: ['text', 'link'],
    });
    expect(sql).toBe('(kr.kind = any($1))');
    expect(params).toEqual([['text', 'link']]);
  });

  it('contains on title → ilike with `%` literals only, value in param', () => {
    const { sql, params } = compile({
      field: 'title',
      op: 'contains',
      value: 'intro',
    });
    expect(sql).toBe("(kr.title ilike '%' || $1 || '%')");
    expect(params).toEqual(['intro']);
  });

  it('status eq round-trips', () => {
    const { sql } = compile({ field: 'status', op: 'eq', value: 'active' });
    expect(sql).toBe('(kr.status = $1)');
  });
});

describe('compileFilter — zero value interpolation (anti-injection)', () => {
  it('never places the value text in the sql string', () => {
    const injection = `text'; drop table knowledge_resources; --`;
    const { sql, params } = compile({
      field: 'title',
      op: 'eq',
      value: injection,
    });
    expect(sql).not.toContain(injection);
    expect(sql).not.toContain('drop table');
    expect(params).toEqual([injection]);
  });

  it('array values stay in params, not in the sql text', () => {
    const { sql } = compile({
      field: 'kind',
      op: 'in',
      value: ['a', 'b', 'c'],
    });
    // no value chars leak — only the placeholder
    expect(sql).toBe('(kr.kind = any($1))');
    expect(sql).not.toMatch(/'a'|'b'|'c'/);
  });
});

describe('compileFilter — contains is title-only', () => {
  for (const field of ['kind', 'status', 'visibility'] as const) {
    it(`throws for contains on ${field}`, () => {
      expect(() => compile({ field, op: 'contains', value: 'x' })).toThrowError(
        /contains.*only valid on 'title'/
      );
    });
  }
});

describe('compileFilter — anti-injection throws', () => {
  it('throws for a field outside the allow-list (incl. removed `tag`)', () => {
    expect(() =>
      // `tag` is no longer a valid filter field (Variant B); cast past the type.
      compile({ field: 'tag', op: 'eq', value: 'kb' } as unknown as FilterNode)
    ).toThrowError(/field not in allow-list/);
  });

  it('throws for an identity/access field', () => {
    expect(() =>
      compile({
        field: 'space_id',
        op: 'eq',
        value: 'spc_x',
      } as unknown as FilterNode)
    ).toThrowError(/field not in allow-list/);
  });

  it('throws for an operator outside the allow-list', () => {
    expect(() =>
      compile({
        field: 'kind',
        op: 'like',
        value: 'x',
      } as unknown as FilterNode)
    ).toThrowError(/operator not in allow-list/);
  });

  it('throws when `in` gets a scalar instead of an array', () => {
    expect(() =>
      compile({
        field: 'kind',
        op: 'in',
        value: 'text',
      } as unknown as FilterNode)
    ).toThrowError(/'in' requires an array/);
  });

  it('throws when `eq` gets an array instead of a scalar', () => {
    expect(() =>
      compile({
        field: 'kind',
        op: 'eq',
        value: ['a', 'b'],
      } as unknown as FilterNode)
    ).toThrowError(/'eq' requires a scalar/);
  });
});

describe('compileFilter — boolean AST parenthesization & param order', () => {
  it('and → parenthesized, params in traversal order', () => {
    const { sql, params } = compile({
      and: [
        { field: 'kind', op: 'in', value: ['text', 'link'] },
        { field: 'status', op: 'eq', value: 'active' },
      ],
    });
    expect(sql).toBe('((kr.kind = any($1)) and (kr.status = $2))');
    expect(params).toEqual([['text', 'link'], 'active']);
  });

  it('or → parenthesized', () => {
    const { sql } = compile({
      or: [
        { field: 'status', op: 'eq', value: 'active' },
        { field: 'status', op: 'eq', value: 'draft' },
      ],
    });
    expect(sql).toBe('((kr.status = $1) or (kr.status = $2))');
  });

  it('not → parenthesized', () => {
    const { sql } = compile({
      not: { field: 'visibility', op: 'eq', value: 'private' },
    });
    expect(sql).toBe('(not (kr.visibility = $1))');
  });

  it('nested and/or/not keeps deterministic param numbering', () => {
    const { sql, params } = compile({
      or: [
        { field: 'kind', op: 'eq', value: 'text' },
        { not: { field: 'status', op: 'eq', value: 'archived' } },
      ],
    });
    expect(sql).toBe('((kr.kind = $1) or (not (kr.status = $2)))');
    expect(params).toEqual(['text', 'archived']);
  });
});
