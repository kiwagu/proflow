'use client';

import {
  Command,
  CommandInput,
  CommandList,
} from '@workspace/ui/components/command';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { HighlightedText } from '@workspace/ui/components/highlight-text';
import { ResultList } from './result-list.js';
import type { SearchHit } from './search-provider.js';
import { useSearchLens } from './use-search-lens.js';

/**
 * The Search lens surface — the other configuration of the shared
 * `ResultList`: same rows, same states, plus the snippet slot filled with
 * the document's best-matching excerpt.
 *
 * Inline, not a dialog: it stands where the projection panes stand when the
 * host's `search` scope is active, with the term in the URL like every other
 * lens. A hit is a document, so activation is one handler — there is no
 * per-kind dispatch to make.
 */

export type SearchLensLabels = {
  placeholder: string;
  /** Shown before the term is long enough to search. */
  idle: string;
  searching: string;
  /** Given the trimmed term, the "nothing matched" line. */
  noResults: (term: string) => string;
  /** The host wired no search engine (no embedder on this device). */
  unavailable: string;
  /** Given the engine's message, the failed-query line. */
  failed: (message: string) => string;
  /** A hit whose document has no title yet. */
  untitled: string;
};

/** Every hit is a document: the row's kind is fixed. */
const HIT_KIND = 'text';

export function SearchLens({
  term,
  onTermChange,
  onOpenDocument,
  labels,
  limit,
  autoFocus = true,
}: {
  /** The term, owned by the host (deep-linkable like any lens scope). */
  term: string;
  onTermChange: (term: string) => void;
  onOpenDocument: (hit: SearchHit) => void;
  labels: SearchLensLabels;
  limit?: number;
  autoFocus?: boolean;
}) {
  const lens = useSearchLens(term, { limit });

  const rowOf = (hit: SearchHit) => ({
    id: hit.documentId,
    kind: HIT_KIND,
    title: hit.title || labels.untitled,
  });

  return (
    <Command
      shouldFilter={false}
      className="bg-transparent"
      data-testid="search-lens"
      data-reach={lens.reach ?? undefined}
    >
      <CommandInput
        value={term}
        onValueChange={onTermChange}
        placeholder={labels.placeholder}
        autoFocus={autoFocus}
        disabled={lens.unavailable}
        data-testid="search-lens-input"
      />
      <CommandList className="max-h-none" data-testid="search-lens-results">
        {lens.unavailable ? (
          <EmptyState className="py-8" data-testid="search-lens-unavailable">
            {labels.unavailable}
          </EmptyState>
        ) : lens.error !== null ? (
          <EmptyState className="py-8" data-testid="search-lens-error">
            {labels.failed(lens.error)}
          </EmptyState>
        ) : (
          <ResultList
            items={lens.hits}
            rowOf={rowOf}
            snippet={(hit) =>
              hit.excerpt ? (
                <HighlightedText text={hit.excerpt} term={lens.trimmed} />
              ) : null
            }
            term={lens.trimmed}
            labels={labels}
            tooShort={lens.tooShort}
            loading={lens.loading}
            showEmpty={lens.showEmpty}
            onPick={onOpenDocument}
            testId="search-lens"
          />
        )}
      </CommandList>
    </Command>
  );
}
