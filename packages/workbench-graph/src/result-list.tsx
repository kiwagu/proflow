'use client';

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@workspace/ui/components/command';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { HighlightedText } from '@workspace/ui/components/highlight-text';
import {
  FileText,
  Folder,
  Link,
  Paperclip,
  PlayCircle,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The ONE ranked-result list of the workbench — the command palette and the
 * search lens are two configurations of it, not two lists.
 *
 * A row is whatever the caller's query returned; the list only asks how to
 * key, title and label it, and — optionally — what to show under the title.
 * That `snippet` slot is the whole difference between the palette (a title
 * index, nothing to excerpt) and the search lens (a content index, where the
 * matched excerpt IS the result). Rows arrive ranked by the query and render
 * in that order: cmdk's own filter is off, so the reader stays the authority.
 *
 * Every state the list can be in is a prop, decided by the hook that owns the
 * query, so the two consumers cannot drift in when they say "keep typing",
 * "searching…" or "nothing matched".
 */

const KIND_ICON: Record<string, LucideIcon> = {
  folder: Folder,
  text: FileText,
  file: Paperclip,
  video: PlayCircle,
  link: Link,
  tag: Tag,
};

export function iconForKind(kind: string): LucideIcon {
  return KIND_ICON[kind] ?? FileText;
}

export type ResultListLabels = {
  /** Shown before the term is long enough to search. */
  idle: string;
  searching: string;
  /** Given the trimmed term, the "nothing matched" line. */
  noResults: (term: string) => string;
};

export type ResultListRow = {
  id: string;
  /** Picks the leading icon and the trailing label. */
  kind: string;
  title: string;
};

export type ResultListProps<T> = {
  items: readonly T[];
  /** The id, kind and title the list renders a row from. */
  rowOf: (item: T) => ResultListRow;
  /** The trailing label for a row's kind; absent → no trailing label. */
  kindLabel?: (kind: string) => string;
  /**
   * OPTIONAL per-row excerpt under the title. Absent (the palette) → the row
   * is one line; present (the search lens) → the matched text shows, so the
   * quality of the excerpt — the quality of the search — is visible.
   */
  snippet?: (item: T) => ReactNode;
  /** The trimmed term — highlighted where it occurs in a title. */
  term: string;
  labels: ResultListLabels;
  tooShort: boolean;
  loading: boolean;
  /** Nothing matched a term long enough to have been searched. */
  showEmpty: boolean;
  onPick: (item: T) => void;
  /** The `data-testid` prefix the consumer's e2e reads rows by. */
  testId: string;
};

export function ResultList<T>({
  items,
  rowOf,
  kindLabel,
  snippet,
  term,
  labels,
  tooShort,
  loading,
  showEmpty,
  onPick,
  testId,
}: ResultListProps<T>) {
  return (
    <>
      {tooShort ? (
        <EmptyState className="py-8">{labels.idle}</EmptyState>
      ) : loading && items.length === 0 ? (
        <EmptyState className="py-8">{labels.searching}</EmptyState>
      ) : null}

      {/* Driven off the resolved query rather than cmdk's filtered count:
          the input is decoupled from cmdk's filter, so its heuristic is
          not the authority here. */}
      {showEmpty ? (
        <CommandEmpty data-testid={`${testId}-empty`}>
          {labels.noResults(term)}
        </CommandEmpty>
      ) : null}

      {items.length > 0 ? (
        <CommandGroup>
          {items.map((item) => {
            const row = rowOf(item);
            const Icon = iconForKind(row.kind);
            const excerpt = snippet?.(item);
            return (
              <CommandItem
                key={row.id}
                // cmdk keys an item by its value; the row id keeps rows
                // distinct and maps selection 1:1.
                value={row.id}
                onSelect={() => onPick(item)}
                data-testid={`${testId}-result`}
                className="gap-3"
              >
                <Icon
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    <HighlightedText text={row.title} term={term} />
                  </span>
                  {excerpt ? (
                    <span
                      className="text-muted-foreground line-clamp-2 text-xs"
                      data-testid={`${testId}-snippet`}
                    >
                      {excerpt}
                    </span>
                  ) : null}
                </span>
                {kindLabel ? (
                  <CommandShortcut className="shrink-0 tracking-normal">
                    {kindLabel(row.kind)}
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ) : null}
    </>
  );
}
