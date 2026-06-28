import type { SearchQuery } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { compileSearchQuery } from './search.compiler.js';

function lexical(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    mode: 'lexical',
    term: 'getting',
    limit: 25,
    ...overrides,
  } as SearchQuery;
}

describe('compileSearchQuery — prefix/exact tier SQL shape', () => {
  it('normalizes the term and both fields, prefix uses LIKE on the normalized text', () => {
    const { sql } = compileSearchQuery(lexical({ term: 'getting' }));
    // term wraps the bound placeholder in kb.search_normalize(...)
    expect(sql).toContain('kb.search_normalize($1)');
    // both fields are normalized
    expect(sql).toContain('kb.search_normalize(kr.title)');
    expect(sql).toContain("kb.search_normalize(coalesce(rd.body, ''))");
    // prefix is LIKE on the normalized text expression (NOT the collation)
    expect(sql).toContain("like kb.search_normalize($1) || '%'");
  });

  it('left-joins the description satellite by node_id', () => {
    const { sql } = compileSearchQuery(lexical());
    expect(sql).toContain(
      'left join kb.resource_description rd on rd.node_id = kr.id'
    );
    expect(sql).toContain('from public.knowledge_resources kr');
  });

  it('selects exactly the contract columns + score + matched_field', () => {
    const { sql } = compileSearchQuery(lexical());
    for (const col of [
      'kr.id',
      'kr.kind',
      'kr.title',
      'kr.status',
      'kr.visibility',
      'kr.body_ref',
    ]) {
      expect(sql).toContain(col);
    }
    expect(sql).toContain('as score');
    expect(sql).toContain('as matched_field');
  });

  it('scores title above description and exact above prefix', () => {
    const { sql } = compileSearchQuery(lexical());
    // title exact (4) is tested before title prefix (3) before body exact (2)
    // before body prefix (1) — the CASE arm order encodes the precedence.
    const titleExact = sql.indexOf('then 4');
    const titlePrefix = sql.indexOf('then 3');
    const bodyExact = sql.indexOf('then 2');
    const bodyPrefix = sql.indexOf('then 1');
    expect(titleExact).toBeGreaterThanOrEqual(0);
    expect(titleExact).toBeLessThan(titlePrefix);
    expect(titlePrefix).toBeLessThan(bodyExact);
    expect(bodyExact).toBeLessThan(bodyPrefix);
  });
});

describe('compileSearchQuery — ORDER BY uses the ICU collation (never a LIKE)', () => {
  it('orders by score desc then title COLLATE kb.text_ci_ai then id', () => {
    const { sql } = compileSearchQuery(lexical());
    expect(sql).toContain(
      'order by score desc, kr.title collate kb.text_ci_ai asc, kr.id asc'
    );
    // the collation must NEVER appear inside a like predicate
    expect(sql).not.toMatch(/collate kb\.text_ci_ai[^\n]*like/i);
    expect(sql).not.toMatch(/like[^\n]*collate kb\.text_ci_ai/i);
  });
});

describe('compileSearchQuery — zero value interpolation (anti-injection)', () => {
  it('never places the term text in the sql string', () => {
    const injection = `x'; drop table knowledge_resources; --`;
    const { sql, params } = compileSearchQuery(lexical({ term: injection }));
    expect(sql).not.toContain(injection);
    expect(sql).not.toContain('drop table');
    expect(params[0]).toBe(injection);
  });

  it('the term is bound exactly once as $1', () => {
    const { sql, params } = compileSearchQuery(lexical({ term: 'getting' }));
    // every term reference is the same placeholder
    expect(sql).toContain('$1');
    expect(params[0]).toBe('getting');
    // $2 is the limit (no scope/cursor here)
    expect(sql).toContain('limit $2');
    expect(params[1]).toBe(25);
  });
});

describe('compileSearchQuery — scope narrowing (NARROWS, never the fence)', () => {
  it('kinds → kind = any($n) with the array bound, never inlined', () => {
    const { sql, params } = compileSearchQuery(
      lexical({ scope: { spaceId: 'spc_1', kinds: ['folder', 'file'] } })
    );
    expect(sql).toContain('kr.kind = any($2)');
    expect(sql).not.toMatch(/'folder'|'file'/);
    expect(params).toContainEqual(['folder', 'file']);
  });

  it('statuses + visibility each bind as a separate array param', () => {
    const { sql, params } = compileSearchQuery(
      lexical({
        scope: {
          spaceId: 'spc_1',
          statuses: ['active'],
          visibility: ['private', 'space'],
        },
      })
    );
    expect(sql).toContain('kr.status = any($2)');
    expect(sql).toContain('kr.visibility = any($3)');
    expect(params).toContainEqual(['active']);
    expect(params).toContainEqual(['private', 'space']);
  });

  it('no scope → no scope predicate, only the match predicate', () => {
    const { sql } = compileSearchQuery(lexical());
    expect(sql).not.toContain('kr.kind = any');
    expect(sql).not.toContain('kr.status = any');
    expect(sql).not.toContain('kr.visibility = any');
  });
});

describe('compileSearchQuery — keyset cursor (load more)', () => {
  it('decodes score:id and binds both parts (never inlined)', () => {
    const { sql, params } = compileSearchQuery(
      lexical({ cursor: '3:knr_abc' })
    );
    // a cursor predicate on (score, id) appears
    expect(sql).toMatch(/< \$\d+ or/);
    expect(sql).toContain('kr.id > $');
    expect(params).toContain(3);
    expect(params).toContain('knr_abc');
    expect(sql).not.toContain('knr_abc');
  });

  it('a malformed cursor yields no cursor predicate (first page)', () => {
    const { sql } = compileSearchQuery(lexical({ cursor: 'garbage' }));
    expect(sql).not.toMatch(/kr\.id > \$/);
  });
});

describe('compileSearchQuery — limit clamping', () => {
  it('clamps an oversized limit to the max', () => {
    const { params } = compileSearchQuery(lexical({ limit: 100000 }));
    expect(params[params.length - 1]).toBe(100);
  });
});
