import type { SearchQuery, SearchResult } from '@workspace/knowledge-contracts';
import {
  parseSearchQuery,
  searchResultSchema,
} from '@workspace/knowledge-contracts';

import { compileSearchQuery, encodeSearchCursor } from './search.compiler.js';
import {
  renderRpcQuery,
  type ResolveQueryTransport,
} from './projection.resolver.js';

/**
 * Search resolver: parses the `SearchQuery`, compiles it, runs it through the
 * INJECTED `ResolveQueryTransport`, and validates the rows back through the domain
 * `SearchResult` contract. A SIBLING of `resolveProjection` — it
 * REUSES the SAME transport (`createProjectionResolveTransport`), so it
 * NEVER constructs its own DB path and can never bypass the RLS fence.
 *
 * RLS safety: the compiled SELECT runs AS THE USER inside the transport (`SET
 * LOCAL ROLE authenticated` + the user's JWT claims). The engine can only NARROW
 * what RLS allows — the optional `scope.statuses`/`scope.visibility` narrowing can
 * shrink results, never widen access. There is NO app-level
 * status/visibility filter acting as the fence (`poc-no-fallbacks`).
 */

type ResolveSearchArgs = {
  /**
   * Server-side execution transport. MUST run the compiled SQL under
   * the requesting user's RLS context, never service-role. The SAME transport the
   * projection resolver uses (`createProjectionResolveTransport(claims)`).
   */
  transport: ResolveQueryTransport;
};

type SearchRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  visibility: string;
  body_ref: unknown;
  score: number;
  matched_field: 'title' | 'description';
  snippet: string | null;
};

export async function resolveSearch(
  query: SearchQuery,
  args: ResolveSearchArgs
): Promise<SearchResult> {
  const parsed = parseSearchQuery(query);
  if (!parsed.success) {
    throw new Error(
      `resolveSearch: invalid search query: ${parsed.error.message}`
    );
  }

  const fragment = compileSearchQuery(parsed.data);
  const { sql, paramsJson } = renderRpcQuery(fragment);

  // Defence-in-depth (parity with the projection resolver): the compiler only
  // ever emits a read-only `select`. This is NOT the security boundary (RLS in
  // the transport is) — it guards against a future caller handing the engine a
  // non-search shape.
  if (!/^\s*select\s/i.test(sql)) {
    throw new Error(
      'resolveSearch: refusing to execute a non-select statement'
    );
  }

  // The transport's row type is the projection shape (shared transport);
  // a search SELECT returns the search columns instead, so re-type through unknown.
  const rows = (await args.transport({
    sql,
    paramsJson,
  })) as unknown as SearchRow[];

  // Raw literal (string ids from the DB transport); `searchResultSchema.parse`
  // below validates the prefixes and brands the ids at this boundary.
  const items = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    visibility: row.visibility,
    body_ref: row.body_ref ?? null,
    score: row.score,
    matchedField: row.matched_field,
    ...(row.snippet != null ? { snippet: row.snippet } : {}),
  }));

  // The keyset cursor for "load more": the (score, title, id) of the last row —
  // the 3-tuple mirroring the ORDER BY EXACTLY — when the page came back FULL (a
  // partial page means no further rows). Decoded back into the cursor predicate on
  // the next call (`compileSearchQuery`).
  const last = rows[rows.length - 1];
  const isFullPage = rows.length >= parsed.data.limit;
  const nextCursor =
    isFullPage && last
      ? encodeSearchCursor(last.score, last.title, last.id)
      : undefined;

  return searchResultSchema.parse({ items, nextCursor });
}
