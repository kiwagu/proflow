'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  parseSearchResult,
  type SearchResultItem,
} from '@workspace/knowledge-contracts';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { Input } from '@workspace/ui/components/input';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { compareText } from '@workspace/ui/lib/sort';
import { Search } from 'lucide-react';
import * as React from 'react';

import { ItemCard } from '@/app/graph/views/drive/drive-projection.view';
import type { KbViewData } from '@/app/graph/views/registry/projection-view.types';
import type { ResourceFloor } from '@/app/graph/graph-data.types';

/**
 * The renderable meta a SEARCH hit carries on the wire (ADR-0024 §1) — the subset of
 * `SearchResultItem` the SHARED ResourcePanel needs to render correct meta when the
 * hit is NOT in the resolved Drive canvas (`kbData`/`result.items`). The workbench
 * keeps these keyed by id and reads them as a FALLBACK so opening a search result
 * (`kind`/`status`/broadcast `visibility`) shows the node's real meta line instead of
 * a bare degraded one — and so the panel opens at all for an out-of-canvas hit (whose
 * `selectedNode` would otherwise resolve to null). `visibility` is the broadcast floor
 * the row already carries; never a fence (RLS already admitted the row to the result).
 */
export type SearchSelection = {
  id: string;
  kind: string;
  title: string;
  status: string;
  visibility: ResourceFloor;
};

/**
 * Fold a string the way the server's `kb.search_normalize` does (lower + strip
 * accents) — for CLIENT-SIDE highlight matching ONLY (ADR-0024 §3a). The server
 * already did the real lexical matching + ranking + snippet extraction; this fold
 * is purely so the term we visually `<mark>` inside the plain-text snippet matches
 * the same case/accent-insensitive boundaries the lexical fold used (so `egerie`
 * highlights inside `Égérie`, `getting` inside `Getting`, `превет`-class folds).
 * NFD + combining-mark strip mirrors `unaccent(lower(...))` for the Latin + Cyrillic
 * cases the search corpus covers; it is a presentation approximation, never a fence.
 */
function foldForHighlight(value: string): string {
  // U+0300–U+036F = the combining diacritical marks NFD splits accents into; drop them
  // to fold `é→e`, `ё→е`-class (the unaccent(lower(...)) approximation, §3a/§3c).
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * HighlightedText — render `text` with each case/accent-insensitive occurrence of
 * `term` wrapped in `<mark>`, emitting REACT NODES (never `dangerouslySetInnerHTML`,
 * so a snippet can never inject markup — the data layer ships PLAIN text). Matching
 * runs over the folded forms (so accents/case fold) but the ORIGINAL substring is
 * rendered, preserving the snippet's real casing/accents. A term that does not occur
 * (e.g. a fuzzy/typo hit whose exact letters aren't in the excerpt) renders the text
 * unmarked — the row is still a valid ranked result, just with nothing to underline.
 */
function HighlightedText({
  text,
  term,
}: {
  text: string;
  term: string;
}): React.ReactElement {
  const trimmed = term.trim();
  if (trimmed.length === 0) {
    return <>{text}</>;
  }
  const foldedText = foldForHighlight(text);
  const foldedTerm = foldForHighlight(trimmed);
  // NFD can change length per char (a precomposed accent → base + combining mark we
  // then strip), so fold per-character and keep a map from FOLDED offset back to the
  // ORIGINAL offset — that lets us slice the original (real casing/accents) at the
  // boundaries we found in the folded string.
  if (foldedTerm.length === 0 || !foldedText.includes(foldedTerm)) {
    return <>{text}</>;
  }
  // Build the folded->original index map (folding each char independently keeps the
  // 1:N relationship local and the map exact for the BMP text the corpus uses).
  const foldedToOriginal: number[] = [];
  let folded = '';
  for (let i = 0; i < text.length; i += 1) {
    const piece = foldForHighlight(text[i] ?? '');
    for (let j = 0; j < piece.length; j += 1) {
      foldedToOriginal.push(i);
    }
    folded += piece;
  }
  foldedToOriginal.push(text.length); // sentinel for the end boundary

  const parts: React.ReactNode[] = [];
  let cursor = 0; // offset in the FOLDED string
  let key = 0;
  for (;;) {
    const hit = folded.indexOf(foldedTerm, cursor);
    if (hit === -1) {
      break;
    }
    const origStart = foldedToOriginal[hit] ?? text.length;
    const origEnd = foldedToOriginal[hit + foldedTerm.length] ?? text.length;
    if (origStart > (foldedToOriginal[cursor] ?? 0)) {
      parts.push(text.slice(foldedToOriginal[cursor] ?? 0, origStart));
    }
    parts.push(
      <mark
        key={key}
        className="bg-primary/15 text-foreground rounded-[2px] px-0.5"
      >
        {text.slice(origStart, origEnd)}
      </mark>
    );
    key += 1;
    cursor = hit + foldedTerm.length;
  }
  const tail = foldedToOriginal[cursor] ?? text.length;
  if (tail < text.length) {
    parts.push(text.slice(tail));
  }
  return <>{parts}</>;
}

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
 * Phase 2 adds the `snippet` excerpt (rendered under each row, with the query term
 * client-highlighted to match the lexical fold) and a stable client tiebreak on equal
 * server score. STILL FIRST PAGE ONLY — the keyset "load more" cursor stays unwired
 * (a separate later increment). The banded `score` is NOT surfaced as UI chrome: it is
 * an internal ranking value, not a user-meaningful number — rows simply render in the
 * server's authoritative `score DESC, title COLLATE kb.text_ci_ai, id` order, with the
 * client only stabilising rows of EQUAL score by title (the same `compareText` the
 * server mirrors).
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
  /**
   * Single-click a row → open the SHARED ResourcePanel (owned by the workbench). The
   * SELECTED search item's renderable meta rides along so the panel can render correct
   * meta even when the hit is NOT in the resolved canvas (`result.items`/`kbData`) —
   * the workbench reads it as a fallback (ADR-0024 §5, out-of-canvas hit follow-up).
   */
  onSelect: (selection: SearchSelection) => void;
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

  // The server is AUTHORITATIVE on order (`score DESC, title COLLATE kb.text_ci_ai,
  // id`). The client only STABILISES rows of EQUAL score by title — `compareText` is
  // the JS mirror of the server `kb.text_ci_ai` collation (ADR-0024 §3c), so this
  // re-sort agrees with the server and never reorders across different scores. (A
  // higher score must never fall below a lower one — so score is the primary key here,
  // title only the equal-score tiebreak, matching how sibling Drive views tiebreak.)
  const sortedItems = React.useMemo(
    () =>
      items
        .slice()
        .sort((a, b) => b.score - a.score || compareText(a.title, b.title)),
    [items]
  );

  const onInput = React.useCallback(
    (next: string) => {
      setTerm(next);
      onTermChange?.(next);
    },
    [onTermChange]
  );

  // Open the shared ResourcePanel for a search hit, carrying the row's own renderable
  // meta up (so an out-of-canvas hit still shows correct kind/status/visibility). The
  // wire `visibility` is `string`; the broadcast floor is one of the three enum values,
  // so narrow it for the panel (RLS already admitted the row — this is display only).
  const onSelectItem = React.useCallback(
    (item: SearchResultItem) => {
      onSelect({
        id: item.id,
        kind: item.kind,
        title: item.title,
        status: item.status,
        visibility: item.visibility as ResourceFloor,
      });
    },
    [onSelect]
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
              footer={
                // The PLAIN-text excerpt the engine extracted (left(body,160) for a
                // description hit, the title for a title-only hit; ADR-0024 §3). The
                // UI does the highlighting — wrap the live query term where it folds
                // into the snippet, as React nodes (never raw HTML). A title-only
                // snippet (== title) is fine to highlight; omitted when no snippet.
                item.snippet ? (
                  <p
                    className="text-muted-foreground line-clamp-2 text-xs"
                    data-testid="drive-search-snippet"
                  >
                    <HighlightedText text={item.snippet} term={trimmed} />
                  </p>
                ) : null
              }
              onOpen={() =>
                item.kind === 'text' && onOpenDocument
                  ? onOpenDocument(item.id)
                  : onSelectItem(item)
              }
              onDetails={() => onSelectItem(item)}
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
