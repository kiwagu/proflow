'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchProvider } from './graph-services.js';
import type { SearchHit, SearchReach } from './search-provider.js';

/**
 * The Search lens: content search over what the device holds.
 *
 * Where the command palette asks the title index, this lens asks the search
 * provider — hybrid vector + full-text over the local document content, the
 * two legs rank-fused. Its result is a ranked list of documents with the
 * best-matching excerpt each, and that excerpt is the point: the quality of
 * the excerpt is the quality of the search, so it is rendered, not hidden.
 *
 * The term is OWNED BY THE HOST (it lives in the URL as a deep link, exactly
 * like the other lens scopes), so the hook takes it as an argument rather
 * than holding it. Everything else — debounce, in-flight ordering, the
 * empty/loading/results split — is decided here so the lens and the palette
 * cannot drift in how they say "keep typing", "searching…", "nothing".
 */

/** Below this many characters a term matches too much to be useful. */
export const MIN_SEARCH_TERM_LENGTH = 2;
/**
 * A query embeds the term on the local model before it hits the database:
 * cheap, but not keystroke-cheap. The palette's title query needs no such
 * wait; this one does.
 */
const DEBOUNCE_MS = 200;
/** How many hits a lens page shows; the pool behind it is wider. */
const DEFAULT_LIMIT = 6;

export type SearchLensState = {
  /** The trimmed term the state answers. */
  trimmed: string;
  hits: SearchHit[];
  /** Nothing to search with — the host wired no search provider. */
  unavailable: boolean;
  /** Which engine answered (or would answer): local replica or server. */
  reach: SearchReach | null;
  tooShort: boolean;
  /** A query for the term in the box is still in flight (or debouncing). */
  loading: boolean;
  resolved: boolean;
  /** Nothing matched a term long enough to have been searched. */
  showEmpty: boolean;
  /** The engine refused the last query; the lens shows this, not stale hits. */
  error: string | null;
};

export function useSearchLens(
  term: string,
  options: { limit?: number } = {}
): SearchLensState {
  const provider = useSearchProvider();
  const limit = options.limit ?? DEFAULT_LIMIT;

  /**
   * The last answer the engine produced, tagged with the term it answers —
   * one piece of state, written ONLY from the query's callback. An answer for
   * a term the user has moved past simply stops matching, so it can neither
   * be shown nor be mistaken for "resolved".
   */
  const [answer, setAnswer] = useState<{
    term: string;
    hits: SearchHit[];
    error: string | null;
  } | null>(null);

  const trimmed = term.trim();
  const tooShort = trimmed.length < MIN_SEARCH_TERM_LENGTH;
  const searching = provider !== null && !tooShort;

  // Every query gets a sequence number and a result is accepted only while
  // it is still the newest: an embed + two index scans are fast, not
  // instantaneous, and out-of-order delivery would show a stale term's hits.
  const sequence = useRef(0);

  useEffect(() => {
    if (!searching) {
      // Invalidate any in-flight request so late arrivals can neither
      // render nor be preserved as a matching answer for this term.
      sequence.current++;
      return;
    }
    const ticket = ++sequence.current;
    const timer = setTimeout(() => {
      void provider.search(trimmed, { limit }).then(
        (result) => {
          if (ticket !== sequence.current) return;
          setAnswer(
            result.isOk()
              ? { term: trimmed, hits: result.value, error: null }
              : { term: trimmed, hits: [], error: result.error }
          );
        },
        (e: unknown) => {
          if (ticket !== sequence.current) return;
          setAnswer({ term: trimmed, hits: [], error: String(e) });
        }
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [limit, provider, searching, trimmed]);

  // An answer counts only while it answers the term in the box.
  const current = searching && answer?.term === trimmed ? answer : null;
  const hits = current?.hits ?? [];
  const resolved = current !== null;

  return {
    trimmed,
    hits,
    unavailable: provider === null,
    reach: provider?.reach ?? null,
    tooShort,
    loading: searching && !resolved,
    resolved,
    showEmpty: resolved && current.error === null && hits.length === 0,
    error: current?.error ?? null,
  };
}
