import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  type SearchQuery,
} from '@workspace/knowledge-contracts';

import { type SqlFragment } from './filter.compiler.js';

/**
 * Search compiler: a `SearchQuery` → a fully-parameterized SQL SELECT over the
 * knowledge graph. Mirrors `filter.compiler.ts` discipline EXACTLY.
 *
 * Anti-injection contract (the SAME standard the projection compiler holds — this
 * is the injection boundary):
 * - EVERY user-supplied value (the term, scope arrays, limit, cursor parts) is
 *   emitted ONLY as a positional `$n` parameter — never interpolated into the SQL
 *   text. The resolver later rewrites each `$n` into a typed jsonb extraction of
 *   the single bound `$1` param (`renderRpcQuery`), so zero value text reaches the
 *   executed SQL.
 * - Column identifiers / table names / functions / the collation are STATIC SQL
 *   the compiler writes from constants — never built from a user string. The
 *   `pg_trgm`/`fuzzystrmatch` operators are SCHEMA-QUALIFIED (`extensions.*`), as
 *   those extensions live in the `extensions` schema.
 * - The threshold / distance bounds are compiler-AUTHORED numeric literals (not
 *   env, per `monorepo-env-minimalism`; not user input) — safe inline in SQL.
 * - scope narrowing (`kinds`/`statuses`/`visibility`) NARROWS an already-RLS-
 *   fenced set; it is NOT the access fence (RLS in the transport is).
 *   It is emitted as `column = any($n)` with the array value bound, never inlined.
 *
 * Matching model — ALL THREE TIERS, combined into ONE `score`:
 *   (a) normalized prefix/exact — LIKE on the normalized TEXT expression (NOT on
 *       the nondeterministic collation, which PG17 forbids for LIKE — verified).
 *       Exact ranks above prefix; title above description.
 *   (b) `pg_trgm` word_similarity — the typo-tolerant tier, gated by
 *       `FUZZY_SIMILARITY_THRESHOLD`. This is what makes `'превет' → 'Привет
 *       команде'` and `'GETTING' → 'Getting Started'` surface when they are not a
 *       prefix. Emitted over BOTH title and description; its disjuncts join the
 *       WHERE so a fuzzy-ONLY hit surfaces.
 *   (c) `fuzzystrmatch` levenshtein — ONLY for very short terms
 *       (`< SHORT_TERM_MAX_LEN` chars) where trigram similarity is unreliable;
 *       lowest weight, tight distance bound (`LEVENSHTEIN_MAX_DISTANCE`). For
 *       terms ≥ that length this tier is NOT emitted at all.
 *
 * SCORE BANDING (the strict, non-overlapping ranking invariant
 * exact > prefix > trgm-fuzzy > levenshtein, title > description at equal tier):
 *
 *     tier                 title band     description band
 *     ----                 ----------     ----------------
 *     exact                  600              400
 *     prefix                 500              300
 *     trgm-fuzzy (b)    200 + sim∈[0,1)  100 + sim∈[0,1)
 *     levenshtein (c)         20               10
 *
 *   The integer bands (600/500/400/300/20/10) are spaced so no tier can reach the
 *   next: the only CONTINUOUS contribution is `word_similarity ∈ [0,1)` added
 *   inside the fuzzy bands, so a title-fuzzy score lives in [200, 201) — strictly
 *   below the 300 description-prefix floor and strictly above the 101 ceiling of a
 *   description-fuzzy. WITHIN the fuzzy tier, a higher `word_similarity` sorts
 *   first (the continuous add is the intra-tier order). `matchedField` is set to
 *   the field that produced the WINNING (highest) tier.
 *
 * Ordering — `score DESC, title COLLATE kb.text_ci_ai ASC, id ASC` (the server
 * mirror of `compareText`; the collation appears in ORDER BY / keyset comparisons
 * ONLY, never in a LIKE/similarity operator). The keyset cursor mirrors this
 * ORDER BY EXACTLY as a 3-tuple `(score, title COLLATE kb.text_ci_ai, id)` so
 * "load more" can neither skip nor repeat a row.
 */

const RESOURCE_ALIAS = 'kr';
const DESCRIPTION_ALIAS = 'rd';

// --- Tier bands (integer floors; see SCORE BANDING above). Higher wins. ---
const SCORE_TITLE_EXACT = 600;
const SCORE_TITLE_PREFIX = 500;
const SCORE_DESCRIPTION_EXACT = 400;
const SCORE_DESCRIPTION_PREFIX = 300;
// Fuzzy bands carry a continuous `word_similarity ∈ [0,1)` ON TOP of the floor,
// so a fuzzy hit sorts by its similarity within the band without crossing into
// the next band.
const SCORE_TITLE_FUZZY_BASE = 200;
const SCORE_DESCRIPTION_FUZZY_BASE = 100;
const SCORE_TITLE_LEVENSHTEIN = 20;
const SCORE_DESCRIPTION_LEVENSHTEIN = 10;

/**
 * `pg_trgm` word_similarity gate for tier (b). ~0.3 catches the verified typo
 * cases (`'превет'→'привет'` ≈ 0.4) without flooding. A compiler constant, NOT
 * env (`monorepo-env-minimalism`) — tune with the seed corpus.
 */
const FUZZY_SIMILARITY_THRESHOLD = 0.3;

/**
 * Tier (c) levenshtein is emitted ONLY for terms shorter than this (trigram
 * similarity is unreliable on 1–2 char terms). Terms ≥ this length skip tier (c).
 */
const SHORT_TERM_MAX_LEN = 3;

/** Tight edit-distance bound for the short-term levenshtein tier. */
const LEVENSHTEIN_MAX_DISTANCE = 1;

type SearchCompileCtx = {
  params: unknown[];
};

function bind(ctx: SearchCompileCtx, value: unknown): string {
  ctx.params.push(value);
  return `$${ctx.params.length}`;
}

/** `kb.search_normalize(<bound term>)` — the normalized search term placeholder. */
function normalizedTerm(ctx: SearchCompileCtx, term: string): string {
  return `kb.search_normalize(${bind(ctx, term)})`;
}

/** Clamp the page size to a sane bound (defends against a hostile/absent limit). */
function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return SEARCH_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.trunc(limit)));
}

/**
 * The keyset cursor for "load more": an opaque, encoded 3-tuple
 * `(score, title, id)` mirroring the ORDER BY EXACTLY. Each part is BOUND as a
 * param (never inlined) — the WHERE clause walks STRICTLY after the last row in
 * the `score DESC, title COLLATE kb.text_ci_ai ASC, id ASC` order, so a page can
 * neither skip nor repeat a row (the Phase-1 `(score, id)` cursor mismatched the
 * 3-key ORDER BY and could do both). A malformed cursor yields no cursor
 * predicate (the first page) — never an error, never a widened result.
 *
 * Encoding: the three parts are length-prefixed so `title` may contain ANY
 * character (including the `score`/`id` separators) without ambiguity:
 *   `<score><titleLen><title><id>`
 * (`` is the ASCII unit separator; the title length disambiguates the
 * boundary to `id`.) This carries a hostile title verbatim and round-trips it.
 */
type DecodedCursor = { score: number; title: string; id: string };

const CURSOR_SEP = '';

export function encodeSearchCursor(
  score: number,
  title: string,
  id: string
): string {
  return `${score}${CURSOR_SEP}${title.length}${CURSOR_SEP}${title}${id}`;
}

function decodeSearchCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) {
    return null;
  }
  const firstSep = cursor.indexOf(CURSOR_SEP);
  if (firstSep <= 0) {
    return null;
  }
  const secondSep = cursor.indexOf(CURSOR_SEP, firstSep + 1);
  if (secondSep <= firstSep + 1) {
    return null;
  }
  const score = Number(cursor.slice(0, firstSep));
  const titleLen = Number(cursor.slice(firstSep + 1, secondSep));
  if (!Number.isFinite(score) || !Number.isInteger(titleLen) || titleLen < 0) {
    return null;
  }
  const titleStart = secondSep + 1;
  const titleEnd = titleStart + titleLen;
  if (titleEnd > cursor.length) {
    return null;
  }
  const title = cursor.slice(titleStart, titleEnd);
  const id = cursor.slice(titleEnd);
  if (id.length === 0) {
    return null;
  }
  return { score, title, id };
}

/**
 * Compile a `SearchQuery` into a parameterized SQL fragment. Emits all three
 * tiers (prefix/exact + trgm-fuzzy + short-term levenshtein) combined into one
 * `score`, the scope narrowing, and the 3-tuple keyset.
 */
export function compileSearchQuery(query: SearchQuery): SqlFragment {
  // `mode` is the semantic seam; today only 'lexical' compiles.
  if (query.mode !== 'lexical') {
    throw new Error(
      `compileSearchQuery: unsupported mode: ${String(query.mode)}`
    );
  }

  const ctx: SearchCompileCtx = { params: [] };

  // The normalized term is bound ONCE and referenced for every tier — title and
  // description, exact/prefix/fuzzy/levenshtein all compare against this single
  // placeholder. `query.term.length` (the RAW term length) decides whether the
  // levenshtein tier is emitted; the term itself stays bound.
  const isShortTerm = query.term.length < SHORT_TERM_MAX_LEN;
  const term = normalizedTerm(ctx, query.term);
  const normalizedTitle = `kb.search_normalize(${RESOURCE_ALIAS}.title)`;
  const normalizedBody = `kb.search_normalize(coalesce(${DESCRIPTION_ALIAS}.body, ''))`;

  // --- Tier (a): normalized prefix / exact. LIKE on the NORMALIZED text (NOT the
  // collation). Only the '%' literal is concatenated; the term stays a bound param.
  const titleExact = `(${normalizedTitle} = ${term})`;
  const titlePrefix = `(${normalizedTitle} like ${term} || '%')`;
  const bodyExact = `(${normalizedBody} = ${term})`;
  const bodyPrefix = `(${normalizedBody} like ${term} || '%')`;

  // --- Tier (b): pg_trgm word_similarity (schema-qualified — pg_trgm lives in
  // `extensions`). The threshold is a compiler numeric literal (safe inline).
  const titleSim = `extensions.word_similarity(${term}, ${normalizedTitle})`;
  const bodySim = `extensions.word_similarity(${term}, ${normalizedBody})`;
  const titleFuzzy = `(${titleSim} >= ${FUZZY_SIMILARITY_THRESHOLD})`;
  const bodyFuzzy = `(${bodySim} >= ${FUZZY_SIMILARITY_THRESHOLD})`;

  // --- Tier (c): fuzzystrmatch levenshtein — ONLY for very short terms. Bounded
  // by a tight distance (compiler literal). For terms ≥ SHORT_TERM_MAX_LEN this
  // tier is absent entirely (no predicate, no score arm).
  const titleLev = isShortTerm
    ? `(extensions.levenshtein(${term}, ${normalizedTitle}) <= ${LEVENSHTEIN_MAX_DISTANCE})`
    : null;
  const bodyLev = isShortTerm
    ? `(extensions.levenshtein(${term}, ${normalizedBody}) <= ${LEVENSHTEIN_MAX_DISTANCE})`
    : null;

  // score: the highest tier the row satisfies. CASE arms are tested top-down, so
  // exact > prefix > fuzzy > levenshtein and title > description fall out of the
  // arm order. The fuzzy arms add `word_similarity` to the band floor so a higher
  // similarity sorts first WITHIN the band (continuous intra-tier order).
  const scoreArms = [
    `    when ${titleExact} then ${SCORE_TITLE_EXACT}`,
    `    when ${titlePrefix} then ${SCORE_TITLE_PREFIX}`,
    `    when ${bodyExact} then ${SCORE_DESCRIPTION_EXACT}`,
    `    when ${bodyPrefix} then ${SCORE_DESCRIPTION_PREFIX}`,
    `    when ${titleFuzzy} then ${SCORE_TITLE_FUZZY_BASE} + ${titleSim}`,
    `    when ${bodyFuzzy} then ${SCORE_DESCRIPTION_FUZZY_BASE} + ${bodySim}`,
  ];
  if (titleLev) {
    scoreArms.push(`    when ${titleLev} then ${SCORE_TITLE_LEVENSHTEIN}`);
  }
  if (bodyLev) {
    scoreArms.push(`    when ${bodyLev} then ${SCORE_DESCRIPTION_LEVENSHTEIN}`);
  }
  const scoreExpr = ['case', ...scoreArms, '    else 0', '  end'].join('\n');

  // matchedField: 'title' when ANY title tier won, else 'description'. Arms mirror
  // the score arm order so the field tracks the WINNING tier. (A row only survives
  // the WHERE if at least one field matched, so the else is description.)
  const titleAny = [titleExact, titlePrefix, titleFuzzy, titleLev]
    .filter((part): part is string => part !== null)
    .join(' or ');
  const matchedFieldExpr = `case when (${titleAny}) then 'title' else 'description' end`;

  // snippet: a PLAIN-TEXT lexical excerpt (the UI does highlighting — no HTML/<mark>
  // crosses the data layer). For a description match, the description body window;
  // for a title-only match, the title. (See SNIPPET FORMAT comment on snippetExpr.)
  // A description hit is "any tier matched the body" — mirrors the matchedField else.
  const bodyAny = [bodyExact, bodyPrefix, bodyFuzzy, bodyLev]
    .filter((part): part is string => part !== null)
    .join(' or ');
  // SNIPPET FORMAT (kept lexical-simple — NO ts_headline/tsvector):
  //   - description match → the first SNIPPET_MAX_LEN chars of the body (a leading
  //     window; the UI highlights the term within it). Plain text.
  //   - title-only match  → the title.
  // The window is a fixed leading slice (not centred on the match) deliberately —
  // a centred window needs the normalized match offset, which is fuzzy/locale-
  // dependent; the leading slice is deterministic, cheap, and good enough for a
  // lexical preview. The UI owns highlighting.
  const SNIPPET_MAX_LEN = 160;
  const snippetExpr = `case when (${bodyAny}) and ${DESCRIPTION_ALIAS}.body is not null then left(${DESCRIPTION_ALIAS}.body, ${SNIPPET_MAX_LEN}) else ${RESOURCE_ALIAS}.title end`;

  // Scope narrowing — each NARROWS an already-RLS-fenced set (never the fence).
  // Emitted as `column = any($n)` with the array value bound (never inlined).
  const scopePredicates: string[] = [];
  const scope = query.scope;
  if (scope?.kinds && scope.kinds.length > 0) {
    scopePredicates.push(
      `${RESOURCE_ALIAS}.kind = any(${bind(ctx, scope.kinds)})`
    );
  }
  if (scope?.statuses && scope.statuses.length > 0) {
    scopePredicates.push(
      `${RESOURCE_ALIAS}.status = any(${bind(ctx, scope.statuses)})`
    );
  }
  if (scope?.visibility && scope.visibility.length > 0) {
    scopePredicates.push(
      `${RESOURCE_ALIAS}.visibility = any(${bind(ctx, scope.visibility)})`
    );
  }

  // The match predicate: at least one field matched in ANY tier (incl. the fuzzy
  // disjuncts, so a fuzzy-only hit surfaces). This is the result-membership
  // condition — NOT an access fence (RLS in the transport is).
  const matchDisjuncts = [
    titleExact,
    titlePrefix,
    bodyExact,
    bodyPrefix,
    titleFuzzy,
    bodyFuzzy,
    titleLev,
    bodyLev,
  ].filter((part): part is string => part !== null);
  const matchPredicate = `(${matchDisjuncts.join(' or ')})`;

  // Keyset cursor: a 3-tuple mirroring the ORDER BY EXACTLY
  // (score DESC, title COLLATE kb.text_ci_ai ASC, id ASC). `>`/`<` ARE allowed on
  // a nondeterministic collation (only LIKE is forbidden — verified), so the
  // `title COLLATE` comparison is legal in the keyset. All three parts BOUND.
  //   walk after (S, T, I)  ⟺  score < S
  //                            OR (score = S AND title > T)
  //                            OR (score = S AND title = T AND id > I)
  // The fuzzy-band `score` is fractional (floor + `word_similarity`); the resolver
  // casts the bound cursor as `::numeric` (not `::int`) so it is not truncated.
  // `word_similarity` returns `real` (float4, ~7 sig digits) and is DETERMINISTIC
  // for identical normalized inputs, so its JS-number round-trip is lossless and
  // the recomputed `score = $cursor` arm matches the prior page's last row exactly.
  const cursor = decodeSearchCursor(query.cursor);
  let cursorPredicate: string | null = null;
  if (cursor) {
    const cScore = bind(ctx, cursor.score);
    const cTitle = bind(ctx, cursor.title);
    const cId = bind(ctx, cursor.id);
    const titleCmp = `${RESOURCE_ALIAS}.title collate kb.text_ci_ai`;
    cursorPredicate = [
      `((${scoreExpr}) < ${cScore}`,
      ` or ((${scoreExpr}) = ${cScore} and ${titleCmp} > ${cTitle} collate kb.text_ci_ai)`,
      ` or ((${scoreExpr}) = ${cScore} and ${titleCmp} = ${cTitle} collate kb.text_ci_ai and ${RESOURCE_ALIAS}.id > ${cId}))`,
    ].join('\n');
  }

  const whereParts = [matchPredicate, ...scopePredicates];
  if (cursorPredicate) {
    whereParts.push(cursorPredicate);
  }

  const limit = clampLimit(query.limit);

  // ORDER BY: score DESC, then the server mirror of compareText via the ICU
  // collation (collation in ORDER BY / keyset ONLY — PG17 forbids it in a LIKE).
  // The `id` tiebreak makes the 3-tuple keyset cursor total/stable.
  const sql = [
    'select',
    `  ${RESOURCE_ALIAS}.id,`,
    `  ${RESOURCE_ALIAS}.kind,`,
    `  ${RESOURCE_ALIAS}.title,`,
    `  ${RESOURCE_ALIAS}.status,`,
    `  ${RESOURCE_ALIAS}.visibility,`,
    `  ${RESOURCE_ALIAS}.body_ref,`,
    `  (${scoreExpr}) as score,`,
    `  (${matchedFieldExpr}) as matched_field,`,
    `  (${snippetExpr}) as snippet`,
    `from public.knowledge_resources ${RESOURCE_ALIAS}`,
    `left join kb.resource_description ${DESCRIPTION_ALIAS} on ${DESCRIPTION_ALIAS}.node_id = ${RESOURCE_ALIAS}.id`,
    `where ${whereParts.map((part) => `(${part})`).join('\n  and ')}`,
    `order by score desc, ${RESOURCE_ALIAS}.title collate kb.text_ci_ai asc, ${RESOURCE_ALIAS}.id asc`,
    `limit ${bind(ctx, limit)}`,
  ].join('\n');

  return { sql, params: ctx.params };
}
