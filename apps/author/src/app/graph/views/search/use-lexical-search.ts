'use client';

import {
  parseSearchResult,
  type SearchResultItem,
} from '@workspace/knowledge-contracts';
import { compareText } from '@workspace/ui/lib/sort';
import * as React from 'react';

/**
 * useLexicalSearch — the ONE client-side fetch path to the lexical-search capability
 * (slice-12). Extracted so EVERY consumer (the Drive search lens, the
 * command palette, any future global search) hits the SAME server route the SAME way:
 * a debounced, min-2-char, race-safe POST to `/author/graph/search` that the server
 * compiles + runs AS THE USER (Postgres RLS is the sole fence). The hook
 * itself adds NO access logic and NO new route: it is pure transport reuse. Consumers
 * differ only in how they RENDER the identical `SearchResultItem[]` it returns.
 *
 * Behaviour mirrors the original lens hand-roll verbatim (so extracting it can't shift
 * the lens): same 280ms debounce, same 2-char floor, same stale-token guard, same
 * `score DESC, title` client tiebreak (the server is authoritative on order; the client
 * only stabilises EQUAL-score rows by the `kb.text_ci_ai`-mirroring `compareText`).
 */

/** Debounce before firing a search (parity with the member-picker async search). */
export const SEARCH_DEBOUNCE_MS = 280;
/** Minimum term length before a query fires — below this we never hit the server. */
export const SEARCH_MIN_CHARS = 2;

export type LexicalSearchState = {
  /** The server-ordered, equal-score-stabilised result rows for the current term. */
  items: SearchResultItem[];
  /** A query is in flight (debounce elapsed, response not yet landed). */
  loading: boolean;
  /** At least one query has RESOLVED for the current term (distinguishes "no results"
   * from "haven't searched yet" — the idle prompt vs the empty state). */
  resolved: boolean;
  /** The term is below the min length (or no space) — never hits the server. */
  tooShort: boolean;
  /** The trimmed term the rows correspond to (for highlight + the no-results label). */
  trimmed: string;
};

/**
 * Resolve a live lexical-search term against `/author/graph/search` under the user's
 * RLS. `spaceId`/`term` drive the effect; everything else is derived. The caller owns
 * the input element + term state — this hook only turns a term into ranked rows.
 */
export function useLexicalSearch(
  spaceId: string | undefined,
  term: string
): LexicalSearchState {
  const [items, setItems] = React.useState<SearchResultItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [resolved, setResolved] = React.useState(false);

  // Stale-response guard: every fired fetch bumps the token; a response whose token is
  // no longer current is dropped (race-safe across the debounce + fast typing).
  const fetchToken = React.useRef(0);

  const trimmed = term.trim();
  const tooShort = !spaceId || trimmed.length < SEARCH_MIN_CHARS;

  React.useEffect(() => {
    const tooShortNow = !spaceId || trimmed.length < SEARCH_MIN_CHARS;
    // Invalidate any in-flight response immediately (so a stale fetch can't land after
    // the term shrank). State changes happen ASYNCHRONOUSLY below — never synchronously
    // in this effect body — so no cascading-render warning.
    fetchToken.current += 1;

    const handle = window.setTimeout(() => {
      const token = (fetchToken.current += 1);
      // Below the min length (or no space) we never hit the server — reset to the idle
      // prompt. Done in this timer callback (not the effect body), so the reset is
      // asynchronous and cascade-free.
      if (tooShortNow) {
        setItems([]);
        setLoading(false);
        setResolved(false);
        return;
      }
      setLoading(true);
      void fetch('/author/graph/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, term: trimmed }),
      })
        .then(async (res) => {
          if (token !== fetchToken.current) {
            return; // a newer query superseded this one — drop the result.
          }
          if (!res.ok) {
            setItems([]);
            setResolved(true);
            return;
          }
          const parsed = parseSearchResult(await res.json());
          if (token !== fetchToken.current) {
            return;
          }
          setItems(parsed.success ? parsed.data.items : []);
          setResolved(true);
        })
        .catch(() => {
          if (token === fetchToken.current) {
            setItems([]);
            setResolved(true);
          }
        })
        .finally(() => {
          if (token === fetchToken.current) {
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [spaceId, trimmed]);

  // The server is AUTHORITATIVE on order (`score DESC, title COLLATE kb.text_ci_ai,
  // id`). The client only STABILISES rows of EQUAL score by title — `compareText` is
  // the JS mirror of the server `kb.text_ci_ai` collation, so this
  // re-sort agrees with the server and never reorders across different scores.
  const sortedItems = React.useMemo(
    () =>
      items
        .slice()
        .sort((a, b) => b.score - a.score || compareText(a.title, b.title)),
    [items]
  );

  return { items: sortedItems, loading, resolved, tooShort, trimmed };
}
