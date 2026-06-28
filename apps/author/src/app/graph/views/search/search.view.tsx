'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  parseSearchResult,
  type SearchResultItem,
} from '@workspace/knowledge-contracts';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { Input } from '@workspace/ui/components/input';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { byText } from '@workspace/ui/lib/sort';
import { Search } from 'lucide-react';
import * as React from 'react';

import { ItemCard } from '@/app/graph/views/drive/drive-projection.view';
import type { KbViewData } from '@/app/graph/views/registry/projection-view.types';

/**
 * SearchView — the Drive lexical-search lens (ADR-0024 §5, slice-12 Phase 1). NOT a
 * projection over the resolved canvas: it is the first consumer of the standalone
 * SEARCH capability (a SIBLING of projection-resolve), resolving its own
 * `SearchResult` live as the user types. The browser POSTs only a `term` + `spaceId`
 * to `/author/graph/search`; the server compiles + runs the SELECT AS THE USER, so
 * Postgres RLS is the sole access fence (ADR-0024 §6) — a private / other-space node
 * never appears for a non-grantee, with NO app-level filter doing the fencing.
 *
 * Purely presentational beyond the fetch: a debounced, min-2-char input drives the
 * query; each result row REUSES the Drive resource card (`ItemCard`) — a
 * `SearchResultItem` is a SUPERSET of the projection item (ADR-0024 §1), so the same
 * card renders a search row with zero adapter work. Clicking a row opens the SHARED
 * ResourcePanel (owned by the workbench) via `onSelect`; a `text` node opens the
 * reader via `onOpenDocument`.
 *
 * Phase 1 = FIRST PAGE ONLY. `score`/`snippet` and the keyset "load more" cursor are
 * Phase 2 (deliberately not wired here) — this renders the first page of rows.
 */

/** Debounce before firing a search (parity with the member-picker async search). */
const SEARCH_DEBOUNCE_MS = 280;
/** Minimum term length before a query fires — below this we never hit the server. */
const SEARCH_MIN_CHARS = 2;

const GRID_WRAP = 'flex flex-wrap gap-2.5';

export function SearchView({
  messages,
  spaceId,
  initialTerm,
  selectedId,
  onSelect,
  onOpenDocument,
  kbData,
  onTermChange,
}: {
  messages: Record<string, string>;
  spaceId?: string;
  /** The `?q=` term the workbench seeds from the URL (SSR-stable first render). */
  initialTerm: string;
  /** The currently selected node id (shared across views — highlights the row). */
  selectedId?: string;
  /** Single-click a row → open the SHARED ResourcePanel (owned by the workbench). */
  onSelect: (nodeId: string) => void;
  /** Open a `text` node in the reader (owned by the workbench). */
  onOpenDocument?: (nodeId: string) => void;
  /** Server-loaded KB seed — read for the owner "You" label + node meta line. */
  kbData?: KbViewData;
  /** Mirror the live term back to the workbench (which writes `?q=` to the URL). */
  onTermChange?: (term: string) => void;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const [term, setTerm] = React.useState(initialTerm);
  const [items, setItems] = React.useState<SearchResultItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  // True once at least one query has resolved for the current term — so the empty
  // state distinguishes "no results" from "haven't searched yet" (the idle prompt).
  const [resolved, setResolved] = React.useState(false);

  const currentUserId = kbData?.currentUserId ?? null;
  const metaByItem = kbData?.metaByItem ?? {};
  const attributesByItem = kbData?.attributesByItem ?? {};

  // Stale-response guard: every fired fetch bumps the token; a response whose token
  // is no longer current is dropped (race-safe across the debounce + fast typing).
  const fetchToken = React.useRef(0);

  const trimmed = term.trim();
  const tooShort = trimmed.length < SEARCH_MIN_CHARS;

  React.useEffect(() => {
    const tooShortNow = !spaceId || trimmed.length < SEARCH_MIN_CHARS;
    // Invalidate any in-flight response immediately (so a stale fetch can't land
    // after the term shrank). State changes happen ASYNCHRONOUSLY below — never
    // synchronously in this effect body — so no cascading-render warning.
    fetchToken.current += 1;

    const handle = window.setTimeout(() => {
      const token = (fetchToken.current += 1);
      // Below the min length (or no space) we never hit the server — reset to the
      // idle prompt. Done in this timer callback (not the effect body), so the
      // reset is asynchronous and cascade-free.
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

  // Client-side tiebreak by title (case-insensitive, natural) — consistent with the
  // sibling Drive lenses, which sort their card sets via `byText`. The server already
  // orders the page; this only stabilizes equal-rank rows (score is Phase 2).
  const sortedItems = React.useMemo(
    () => items.slice().sort(byText((item) => item.title)),
    [items]
  );

  const onInput = React.useCallback(
    (next: string) => {
      setTerm(next);
      onTermChange?.(next);
    },
    [onTermChange]
  );

  const toolbar = (
    <div className="flex items-center gap-2.5 border-b px-5 py-3">
      <div className="relative w-full max-w-[520px]">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          autoFocus
          value={term}
          onChange={(event) => onInput(event.target.value)}
          placeholder={t('graph.search.placeholder')}
          aria-label={t('graph.search.placeholder')}
          className="pl-9"
          data-testid="drive-search-input"
        />
      </div>
    </div>
  );

  const main = (
    <div className="p-5" data-testid="drive-search-results">
      {tooShort ? (
        <EmptyState>{t('graph.search.idle')}</EmptyState>
      ) : loading && sortedItems.length === 0 ? (
        <EmptyState>{t('graph.search.searching')}</EmptyState>
      ) : resolved && sortedItems.length === 0 ? (
        <EmptyState data-testid="drive-search-empty">
          {t('graph.search.noResults', { term: trimmed })}
        </EmptyState>
      ) : (
        <div className={GRID_WRAP}>
          {sortedItems.map((item) => (
            <ItemCard
              key={item.id}
              t={t}
              node={{ id: item.id, kind: item.kind, title: item.title }}
              attributes={attributesByItem[item.id]}
              meta={metaByItem[item.id]}
              currentUserId={currentUserId}
              layout="grid"
              selected={item.id === selectedId}
              onOpen={() =>
                item.kind === 'text' && onOpenDocument
                  ? onOpenDocument(item.id)
                  : onSelect(item.id)
              }
              onDetails={() => onSelect(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (!spaceId) {
    return null;
  }

  return <WorkbenchShell toolbar={toolbar} main={main} />;
}
