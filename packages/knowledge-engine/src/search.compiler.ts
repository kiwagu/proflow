import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  type SearchQuery,
} from '@workspace/knowledge-contracts';

import { type SqlFragment } from './filter.compiler.js';

/**
 * Search compiler: a `SearchQuery` → a fully-parameterized SQL SELECT over the
 * knowledge graph (ADR-0024 §2). Mirrors `filter.compiler.ts` discipline EXACTLY.
 *
 * Anti-injection contract (the SAME standard the projection compiler holds — this
 * is the injection boundary):
 * - EVERY user-supplied value (the term, scope arrays, limit, cursor parts) is
 *   emitted ONLY as a positional `$n` parameter — never interpolated into the SQL
 *   text. The resolver later rewrites each `$n` into a typed jsonb extraction of
 *   the single bound `$1` param (`renderRpcQuery`), so zero value text reaches the
 *   executed SQL.
 * - Column identifiers / table names / the collation are STATIC SQL the compiler
 *   writes from constants — never built from a user string.
 * - scope narrowing (`kinds`/`statuses`/`visibility`) NARROWS an already-RLS-
 *   fenced set; it is NOT the access fence (RLS in the transport is — ADR-0024 §6).
 *   It is emitted as `column = any($n)` with the array value bound, never inlined.
 *
 * Matching model — PHASE 1 ONLY: tier (a) normalized prefix/exact over BOTH
 * `kb.search_normalize(title)` and `kb.search_normalize(body)` vs
 * `kb.search_normalize(<term>)`. LIKE is legal here — it runs on the normalized
 * TEXT expression, NOT on the nondeterministic collation (PG17 forbids LIKE on a
 * nondeterministic collation — verified). Exact equality ranks above prefix;
 * title outranks description at equal tier. NO `pg_trgm` word_similarity and NO
 * `levenshtein` — those are Phase 2 (ADR-0024 §3b tiers 2/3).
 *
 * Ordering — `score DESC, title COLLATE kb.text_ci_ai` (the server mirror of
 * `compareText`; the collation appears in ORDER BY ONLY, never in a LIKE). Keyset
 * cursor on `(score, id)` for "load more".
 */

const RESOURCE_ALIAS = 'kr';
const DESCRIPTION_ALIAS = 'rd';

// --- Scoring tiers (higher wins). Title outranks description at equal match. ---
//   title exact      = 4   |  title prefix       = 3
//   description exact = 2   |  description prefix = 1
//   (no match on either field → the row is excluded by the WHERE below)
const SCORE_TITLE_EXACT = 4;
const SCORE_TITLE_PREFIX = 3;
const SCORE_DESCRIPTION_EXACT = 2;
const SCORE_DESCRIPTION_PREFIX = 1;

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
 * The keyset cursor for "load more": an opaque `score:id` pair. Decoded into its
 * two parts which are each BOUND as params (never inlined) — the WHERE clause
 * `(score, id) < (cursorScore, cursorId)` walks strictly after the last row in the
 * `score DESC, id` order. A malformed cursor yields no cursor predicate (the first
 * page), never an error and never a widened result.
 */
type DecodedCursor = { score: number; id: string };

export function encodeSearchCursor(score: number, id: string): string {
  return `${score}:${id}`;
}

function decodeSearchCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) {
    return null;
  }
  const sep = cursor.indexOf(':');
  if (sep <= 0 || sep === cursor.length - 1) {
    return null;
  }
  const score = Number(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (!Number.isFinite(score) || id.length === 0) {
    return null;
  }
  return { score, id };
}

/**
 * Compile a `SearchQuery` into a parameterized SQL fragment. Phase 1 emits only
 * the normalized prefix/exact tier + the scope narrowing + the ORDER BY/keyset.
 */
export function compileSearchQuery(query: SearchQuery): SqlFragment {
  // `mode` is the semantic seam; today only 'lexical' compiles (ADR-0024 §4).
  if (query.mode !== 'lexical') {
    throw new Error(
      `compileSearchQuery: unsupported mode: ${String(query.mode)}`
    );
  }

  const ctx: SearchCompileCtx = { params: [] };

  // The normalized term is bound ONCE and referenced for every tier — title and
  // description, exact and prefix all compare against this single placeholder.
  const term = normalizedTerm(ctx, query.term);
  const normalizedTitle = `kb.search_normalize(${RESOURCE_ALIAS}.title)`;
  const normalizedBody = `kb.search_normalize(coalesce(${DESCRIPTION_ALIAS}.body, ''))`;

  // Prefix predicate: LIKE on the NORMALIZED text expression (NOT the collation).
  // Only the '%' literal is concatenated in SQL; the term stays a bound param.
  const titlePrefix = `(${normalizedTitle} like ${term} || '%')`;
  const titleExact = `(${normalizedTitle} = ${term})`;
  const bodyPrefix = `(${normalizedBody} like ${term} || '%')`;
  const bodyExact = `(${normalizedBody} = ${term})`;

  // score: the highest tier the row satisfies. CASE arms are tested top-down, so
  // exact > prefix and title > description fall out of the ordering.
  const scoreExpr = [
    'case',
    `    when ${titleExact} then ${SCORE_TITLE_EXACT}`,
    `    when ${titlePrefix} then ${SCORE_TITLE_PREFIX}`,
    `    when ${bodyExact} then ${SCORE_DESCRIPTION_EXACT}`,
    `    when ${bodyPrefix} then ${SCORE_DESCRIPTION_PREFIX}`,
    '    else 0',
    '  end',
  ].join('\n');

  // matchedField: 'title' when a title tier won, else 'description'. (A row only
  // survives the WHERE if at least one field matched, so the else is description.)
  const matchedFieldExpr = `case when (${titleExact} or ${titlePrefix}) then 'title' else 'description' end`;

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

  // The match predicate: at least one field matched (any tier). This is the
  // result membership condition — NOT an access fence (RLS in the transport is).
  const matchPredicate = `(${titleExact} or ${titlePrefix} or ${bodyExact} or ${bodyPrefix})`;

  // Keyset cursor: walk strictly after the last (score, id) of the prior page in
  // the `score DESC, id ASC` order. Cursor parts are BOUND (never inlined).
  const cursor = decodeSearchCursor(query.cursor);
  const cursorPredicate = cursor
    ? `((${scoreExpr}) < ${bind(ctx, cursor.score)} or ((${scoreExpr}) = ${bind(ctx, cursor.score)} and ${RESOURCE_ALIAS}.id > ${bind(ctx, cursor.id)}))`
    : null;

  const whereParts = [matchPredicate, ...scopePredicates];
  if (cursorPredicate) {
    whereParts.push(cursorPredicate);
  }

  const limit = clampLimit(query.limit);

  // ORDER BY: score DESC, then the server mirror of compareText via the ICU
  // collation (collation in ORDER BY ONLY — PG17 forbids it in a LIKE). The `id`
  // tiebreak makes the keyset cursor total/stable.
  const sql = [
    'select',
    `  ${RESOURCE_ALIAS}.id,`,
    `  ${RESOURCE_ALIAS}.kind,`,
    `  ${RESOURCE_ALIAS}.title,`,
    `  ${RESOURCE_ALIAS}.status,`,
    `  ${RESOURCE_ALIAS}.visibility,`,
    `  ${RESOURCE_ALIAS}.body_ref,`,
    `  (${scoreExpr}) as score,`,
    `  (${matchedFieldExpr}) as matched_field`,
    `from public.knowledge_resources ${RESOURCE_ALIAS}`,
    `left join kb.resource_description ${DESCRIPTION_ALIAS} on ${DESCRIPTION_ALIAS}.node_id = ${RESOURCE_ALIAS}.id`,
    `where ${whereParts.map((part) => `(${part})`).join('\n  and ')}`,
    `order by score desc, ${RESOURCE_ALIAS}.title collate kb.text_ci_ai asc, ${RESOURCE_ALIAS}.id asc`,
    `limit ${bind(ctx, limit)}`,
  ].join('\n');

  return { sql, params: ctx.params };
}
