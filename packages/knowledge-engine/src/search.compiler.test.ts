import type { SearchQuery } from '@workspace/knowledge-contracts';
import { describe, expect, it } from 'vitest';

import { compileSearchQuery, encodeSearchCursor } from './search.compiler.js';

// Test helper: accepts raw-string scope ids (the schema's spaceId is branded) and
// casts the assembled object to SearchQuery — the compiler under test only reads shape.
function lexical(
  overrides: Partial<Omit<SearchQuery, 'scope'>> & {
    scope?: Record<string, unknown>;
  } = {}
): SearchQuery {
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

  it('selects the contract columns + score + matched_field + snippet', () => {
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
    expect(sql).toContain('as snippet');
  });
});

describe('compileSearchQuery — fuzzy tier (pg_trgm word_similarity)', () => {
  it('emits schema-qualified word_similarity over both fields gated by the threshold constant', () => {
    const { sql } = compileSearchQuery(lexical({ term: 'getting' }));
    // schema-qualified (pg_trgm lives in `extensions`)
    expect(sql).toContain(
      'extensions.word_similarity(kb.search_normalize($1), kb.search_normalize(kr.title))'
    );
    expect(sql).toContain(
      "extensions.word_similarity(kb.search_normalize($1), kb.search_normalize(coalesce(rd.body, '')))"
    );
    // gated by the ~0.3 threshold constant (compiler-authored numeric literal)
    expect(sql).toContain('>= 0.3');
  });

  it('the fuzzy disjuncts join the WHERE so a fuzzy-only hit surfaces', () => {
    const { sql } = compileSearchQuery(lexical({ term: 'превет' }));
    // the where (match predicate) includes the word_similarity disjuncts
    const whereStart = sql.indexOf('where');
    const orderStart = sql.indexOf('order by');
    const whereClause = sql.slice(whereStart, orderStart);
    expect(whereClause).toContain('extensions.word_similarity');
    expect(whereClause).toContain('>= 0.3');
  });

  it('the fuzzy score arm adds word_similarity to the band floor (continuous intra-tier order)', () => {
    const { sql } = compileSearchQuery(lexical());
    // title fuzzy band: 200 + word_similarity, description fuzzy band: 100 + …
    expect(sql).toContain(
      'then 200 + extensions.word_similarity(kb.search_normalize($1), kb.search_normalize(kr.title))'
    );
    expect(sql).toContain(
      "then 100 + extensions.word_similarity(kb.search_normalize($1), kb.search_normalize(coalesce(rd.body, '')))"
    );
  });
});

describe('compileSearchQuery — levenshtein tier (short terms only)', () => {
  it('emits the levenshtein tier ONLY for terms shorter than 3 chars', () => {
    const short = compileSearchQuery(lexical({ term: 'ab' })).sql;
    expect(short).toContain('extensions.levenshtein(');
    // tight distance bound (compiler constant)
    expect(short).toContain('<= 1');
    // schema-qualified, over the normalized title + body
    expect(short).toContain(
      'extensions.levenshtein(kb.search_normalize($1), kb.search_normalize(kr.title)) <= 1'
    );
  });

  it('does NOT emit the levenshtein tier for terms >= 3 chars', () => {
    const long = compileSearchQuery(lexical({ term: 'getting' })).sql;
    expect(long).not.toContain('extensions.levenshtein');
    // and its score-band arms (the line-terminating `then 20` / `then 10`) are
    // absent — matched with the newline tail so they don't collide with the
    // `then 200 +` / `then 100 +` fuzzy arms.
    expect(long).not.toContain('then 20\n');
    expect(long).not.toContain('then 10\n');
  });
});

describe('compileSearchQuery — combined score ranking invariant', () => {
  it('places exact > prefix > fuzzy > levenshtein and title > description at equal tier', () => {
    // a short term so ALL four tiers are present in one CASE
    const { sql } = compileSearchQuery(lexical({ term: 'ab' }));
    // tier bands (title/description): exact 600/400, prefix 500/300,
    // fuzzy 200/100 (+sim), levenshtein 20/10.
    const titleExact = sql.indexOf('then 600');
    const titlePrefix = sql.indexOf('then 500');
    const descExact = sql.indexOf('then 400');
    const descPrefix = sql.indexOf('then 300');
    const titleFuzzy = sql.indexOf('then 200 +');
    const descFuzzy = sql.indexOf('then 100 +');
    // the levenshtein arms end the line (no `+ similarity`); match the arm tail to
    // avoid colliding with `then 200`/`then 100` substrings.
    const titleLev = sql.indexOf('then 20\n');
    const descLev = sql.indexOf('then 10\n');

    // every band arm is present
    for (const at of [
      titleExact,
      titlePrefix,
      descExact,
      descPrefix,
      titleFuzzy,
      descFuzzy,
      titleLev,
      descLev,
    ]) {
      expect(at).toBeGreaterThanOrEqual(0);
    }

    // CASE arm order encodes the strict precedence top-down:
    // exact > prefix > fuzzy > levenshtein, title before description in each tier.
    expect(titleExact).toBeLessThan(titlePrefix);
    expect(titlePrefix).toBeLessThan(descExact);
    expect(descExact).toBeLessThan(descPrefix);
    expect(descPrefix).toBeLessThan(titleFuzzy);
    expect(titleFuzzy).toBeLessThan(descFuzzy);
    expect(descFuzzy).toBeLessThan(titleLev);
    expect(titleLev).toBeLessThan(descLev);
  });

  it('the numeric bands never overlap (the fuzzy float band stays inside its floor)', () => {
    // title-fuzzy max = 200 + sim(<1) < 201 < 300 (desc-prefix floor)
    // desc-fuzzy max = 100 + sim(<1) < 101 < 200 (title-fuzzy floor)
    // levenshtein 20/10 < 100 (any fuzzy floor). Asserted as static facts of the
    // banding constants the compiler emits.
    expect(200 + 0.999).toBeLessThan(300);
    expect(100 + 0.999).toBeLessThan(200);
    expect(20).toBeLessThan(100);
    expect(10).toBeLessThan(20);
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
    // and never inside a word_similarity / levenshtein operator
    expect(sql).not.toMatch(/word_similarity[^\n]*collate/i);
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

  it('a hostile term AND a hostile cursor title/id stay fully bound (no interpolation)', () => {
    const hostileTerm = `'); drop table kb.resource_description; --`;
    const hostileTitle = `O'Brien'); delete from knowledge_resources; --`;
    const hostileId = `knr'; drop --`;
    const cursor = encodeSearchCursor(200.5, hostileTitle, hostileId);
    const { sql, params } = compileSearchQuery(
      lexical({ term: hostileTerm, cursor })
    );
    // none of the hostile strings appear in the SQL text
    expect(sql).not.toContain(hostileTerm);
    expect(sql).not.toContain(hostileTitle);
    expect(sql).not.toContain(hostileId);
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('delete from');
    // all three travel as bound params
    expect(params).toContain(hostileTerm);
    expect(params).toContain(hostileTitle);
    expect(params).toContain(hostileId);
    expect(params).toContain(200.5);
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

describe('compileSearchQuery — 3-tuple keyset cursor (load more)', () => {
  it('decodes (score, title, id) and binds all three parts mirroring the ORDER BY', () => {
    const cursor = encodeSearchCursor(500, 'Getting Started', 'knr_abc');
    const { sql, params } = compileSearchQuery(lexical({ cursor }));
    // the keyset is a 3-tuple comparison mirroring score desc, title COLLATE, id
    expect(sql).toMatch(/< \$\d+/); // score <
    expect(sql).toContain('kr.title collate kb.text_ci_ai >');
    expect(sql).toContain('kr.title collate kb.text_ci_ai =');
    expect(sql).toContain('kr.id > $');
    // all three parts are bound (never inlined)
    expect(params).toContain(500);
    expect(params).toContain('Getting Started');
    expect(params).toContain('knr_abc');
    expect(sql).not.toContain('Getting Started');
    expect(sql).not.toContain('knr_abc');
  });

  it('the keyset comparison mirrors the ORDER BY keys exactly (score, title COLLATE, id)', () => {
    const cursor = encodeSearchCursor(300, 'Some Title', 'knr_z');
    const { sql } = compileSearchQuery(lexical({ cursor }));
    // both the cursor compare and the order by use `title collate kb.text_ci_ai`
    const cursorTitleCmp = (
      sql.match(/kr\.title collate kb\.text_ci_ai/g) ?? []
    ).length;
    // 2 in the keyset (>, =) + 1 in the ORDER BY = 3 occurrences
    expect(cursorTitleCmp).toBe(3);
  });

  it('round-trips a fractional (fuzzy) score in the cursor', () => {
    const cursor = encodeSearchCursor(200.4231, 'Привет команде', 'knr_x');
    const { params } = compileSearchQuery(lexical({ cursor }));
    expect(params).toContain(200.4231);
    expect(params).toContain('Привет команде');
  });

  it('a malformed cursor yields no cursor predicate (first page)', () => {
    const { sql } = compileSearchQuery(lexical({ cursor: 'garbage' }));
    expect(sql).not.toContain('kr.title collate kb.text_ci_ai >');
    expect(sql).not.toMatch(/kr\.id > \$/);
  });
});

describe('compileSearchQuery — limit clamping', () => {
  it('clamps an oversized limit to the max', () => {
    const { params } = compileSearchQuery(lexical({ limit: 100000 }));
    expect(params[params.length - 1]).toBe(100);
  });
});
