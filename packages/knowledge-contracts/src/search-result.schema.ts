import { z } from 'zod';

import { projectionResultItemSchema } from './projection-result.schema.js';

/**
 * SearchResult — the output contract of resolving a SearchQuery: an
 * ordered (by score, then title) set of knowledge resources the current user may
 * see (under RLS), each annotated with its match score, the field that produced
 * the winning match, and (later) a highlighted snippet.
 *
 * SUPERSET of `projectionResultItemSchema`: a search row carries the SAME
 * renderable resource fields a projection item does (id/kind/title/status/
 * visibility/body_ref) PLUS `score`/`matchedField`/`snippet`, so the SAME Drive
 * resource card + ResourcePanel render a search row with ZERO adapter work. The
 * traversal-only fields (`depth`/`via_edge_id`) are dropped — search is a read
 * over the one graph, not a traversal — and the search fields are added.
 *
 * Reuse by transform (omit the traversal context, extend with the search fields)
 * rather than hand-copying the resource fields — the resource shape stays single-
 * sourced in `projection-result.schema.ts`.
 */

/** Which field produced the winning match tier. */
export const matchedFieldSchema = z.enum(['title', 'description']);
export type MatchedField = z.infer<typeof matchedFieldSchema>;

export const searchResultItemSchema = projectionResultItemSchema
  .omit({ depth: true, via_edge_id: true })
  .extend({
    // combined match score (tiers; higher wins)
    score: z.number(),
    // the field that produced the winning tier
    matchedField: matchedFieldSchema,
    // PLAIN-TEXT lexical excerpt (Phase 2): for a description match,
    // a leading window of the body; for a title-only match, the title. PLAIN text
    // only — the UI does the term highlighting (no HTML/<mark> crosses the data
    // layer). Optional: a row whose snippet would be empty omits it.
    snippet: z.string().optional(),
  });
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchResultSchema = z.object({
  // already ordered (score desc, then title via the server kb.text_ci_ai mirror)
  items: z.array(searchResultItemSchema),
  // opaque keyset cursor for "load more"; absent when no further page
  nextCursor: z.string().optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export function parseSearchResult(raw: unknown) {
  return searchResultSchema.safeParse(raw);
}
