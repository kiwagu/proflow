'use client';

import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { cn } from '@workspace/ui/lib/utils';
import { Search } from 'lucide-react';
import * as React from 'react';

/**
 * One page of an async, cursor-paged search (the directory-v2
 * contract, kept GENERIC so any future entity-picker reuses it).
 *
 * - `items` — this page's rows, in the source's own (stable) order.
 * - `nextCursor` — an OPAQUE token to fetch the next page; `null` when this is the
 *   last page. The component treats it as opaque and re-sends it unchanged.
 * - `total` — the total count of matches for the current query (across all pages),
 *   so the picker can show `total − shown` remaining as "+N more".
 */
export type AsyncSearchPage<TItem> = {
  items: TItem[];
  nextCursor: string | null;
  total: number;
};

/**
 * Copy for an {@link AsyncSearchPicker}. The component holds NO i18n
 * (ui-i18n-json-required stays in the app) — every visible string is passed in,
 * resolved by the caller's translator.
 */
export type AsyncSearchPickerLabels = {
  searchPlaceholder: string;
  /** In-flight (the first page of a new query is loading). */
  searching: string;
  /** A query returned no rows. */
  empty: string;
  /** Blank-query starter list returned no rows (defaults to `empty`). */
  emptyQuery?: string;
  /** The "Show more" load-next-page control. */
  showMore: string;
  /** Builds the "+N more — keep typing to narrow" footer (`remaining = total − shown`). */
  moreCount: (remaining: number) => string;
};

export type AsyncSearchPickerProps<TItem> = {
  /**
   * Fetch one page. `cursor=null` => the first page for the current query. The
   * caller closes over the data source (space_id / exclusion / RLS db); the
   * component only ever passes `(query, cursor)`.
   */
  fetchPage: (
    query: string,
    cursor: string | null
  ) => Promise<AsyncSearchPage<TItem>>;
  /** Stable identity for list keys + de-dup across appended pages. */
  getKey: (item: TItem) => string;
  /** Render one result row (render-prop — the caller owns avatar/name/email layout). */
  renderItem: (item: TItem) => React.ReactNode;
  /** Selecting a row (the caller does the side effect — POST the grant, etc.). */
  onPick: (item: TItem) => void;
  /** All COPY via props — the component holds NO i18n. */
  labels: AsyncSearchPickerLabels;
  /** Page-size hint (default 5). Informational for the caller's `fetchPage`. */
  pageSize?: number;
  /** Debounce ms before refetching on query change (default 280). */
  debounceMs?: number;
  /**
   * Class on the results `<ul>`. Defaults to a self-contained scroll region
   * (`max-h-56 overflow-y-auto`). Pass a fill-and-scroll class
   * (`min-h-0 flex-1 overflow-y-auto`, with `className` making the root fill) when
   * the picker should grow to fill a fixed-height parent instead of capping itself.
   */
  listClassName?: string;
  /** Focus the search input on mount. */
  autoFocus?: boolean;
  /** Disable the whole picker (e.g. while a mutation is in flight). */
  disabled?: boolean;
  className?: string;
};

/**
 * AsyncSearchPicker — a generic, props-driven async search-and-pick list
 * (the "типовая функция" reuse deliverable). It owns a debounced
 * search `Input`, the cursor "load more" append loop, the remaining-count footer,
 * and the results list; it knows NOTHING about people, grants, spaces, or i18n.
 *
 * Behaviour:
 * - On (debounced) query change it RESETS to page 1 (`cursor=null`), fetches, and
 *   REPLACES the list.
 * - "Show more" fetches `nextCursor` and APPENDS the next page (accumulating items,
 *   de-duped by `getKey`); it shows only while `nextCursor != null`.
 * - When `total > shown` it shows a "+N more" footer (`labels.moreCount`).
 * - It fetches the blank-query starter list once on first enabled render.
 * - Stale-response guard: a request token is bumped on every fetch; a resolved
 *   fetch whose token is no longer current is ignored (race-safe across debounce +
 *   "load more").
 *
 * It is app-flavoured presentational (the "search box over bounded results" shape
 * the product reuses) → lives in `components/platform/`. It composes the existing
 * `Input` + an inline scrollable list (there is no `cmdk`/Command primitive in
 * `@workspace/ui`, and we do not introduce one) per shadcn-patterns-required.
 */
export function AsyncSearchPicker<TItem>({
  fetchPage,
  getKey,
  renderItem,
  onPick,
  labels,
  pageSize = 5,
  debounceMs = 280,
  listClassName = 'max-h-56 overflow-y-auto',
  autoFocus = false,
  disabled = false,
  className,
}: AsyncSearchPickerProps<TItem>) {
  // `pageSize` is part of the contract (the caller threads it into `fetchPage`'s
  // data source); referenced so the prop is honoured even though the component
  // itself does not slice — the source returns the page.
  void pageSize;

  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<TItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [total, setTotal] = React.useState(0);
  // `searching` = first page in flight (replace); `loadingMore` = appending a page.
  const [searching, setSearching] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadedOnce, setLoadedOnce] = React.useState(false);

  // Stale-response guard. Every fetch (debounced page-1 OR "load more") bumps this;
  // a resolved fetch whose token no longer matches is dropped.
  const tokenRef = React.useRef(0);

  const fetchPageRef = React.useRef(fetchPage);
  React.useEffect(() => {
    fetchPageRef.current = fetchPage;
  }, [fetchPage]);

  // Page 1 for `q` — REPLACES the list. Debounced via the effect below.
  const loadFirstPage = React.useCallback(async (q: string): Promise<void> => {
    const token = ++tokenRef.current;
    setSearching(true);
    try {
      const page = await fetchPageRef.current(q, null);
      if (tokenRef.current !== token) {
        return; // a newer query/cursor superseded this response — drop it.
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setTotal(page.total);
      setLoadedOnce(true);
    } finally {
      if (tokenRef.current === token) {
        setSearching(false);
      }
    }
  }, []);

  // "Show more" — APPENDS the next keyset page, de-duped by `getKey`.
  const loadMore = React.useCallback(async (): Promise<void> => {
    if (cursor === null) {
      return;
    }
    const token = ++tokenRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchPageRef.current(query, cursor);
      if (tokenRef.current !== token) {
        return;
      }
      setItems((prev) => {
        const seen = new Set(prev.map(getKey));
        const fresh = page.items.filter((it) => !seen.has(getKey(it)));
        return [...prev, ...fresh];
      });
      setCursor(page.nextCursor);
      setTotal(page.total);
    } finally {
      if (tokenRef.current === token) {
        setLoadingMore(false);
      }
    }
  }, [cursor, query, getKey]);

  // Debounced refetch on query change. A new query is always page 1 (cursor reset
  // happens inside `loadFirstPage`). Runs once on first enabled render for the
  // blank-query starter list.
  React.useEffect(() => {
    if (disabled) {
      return;
    }
    const handle = window.setTimeout(() => {
      void loadFirstPage(query);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [query, disabled, debounceMs, loadFirstPage]);

  const trimmed = query.trim();
  const shown = items.length;
  const remaining = Math.max(0, total - shown);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          className="pl-8"
          value={query}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {/* "+N more" + "Show more" on ONE row pinned UNDER the input, so the hint and the
          load-next-page action both stay visible regardless of how far the results list
          (which owns its own scroll) is scrolled. */}
      {!searching && remaining > 0 ? (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-muted-foreground text-xs">
            {labels.moreCount(remaining)}
          </span>
          {cursor !== null ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={disabled || loadingMore}
              onClick={() => void loadMore()}
            >
              {labels.showMore}
            </Button>
          ) : null}
        </div>
      ) : null}

      {searching ? (
        <p className="text-muted-foreground px-1 text-xs" role="status">
          {labels.searching}
        </p>
      ) : shown > 0 ? (
        <ul className={cn('flex flex-col gap-0.5', listClassName)}>
          {items.map((item) => (
            <li key={getKey(item)}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(item)}
                className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {renderItem(item)}
              </button>
            </li>
          ))}
        </ul>
      ) : !loadedOnce ? null : trimmed !== '' ? (
        <p className="text-muted-foreground px-1 text-xs">{labels.empty}</p>
      ) : (
        <p className="text-muted-foreground px-1 text-xs">
          {labels.emptyQuery ?? labels.empty}
        </p>
      )}
    </div>
  );
}
