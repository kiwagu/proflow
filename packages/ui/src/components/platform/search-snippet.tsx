import type * as React from 'react';

import { HighlightedText } from '@workspace/ui/components/highlight-text';

/**
 * SearchSnippet — the matched-excerpt presentation shared by a search lens's two layouts:
 * a grid card footer and a list table's "Match" cell. Both render the SAME muted, extra-small,
 * line-clamped excerpt with the live query term client-highlighted (`HighlightedText`) and the
 * SAME `testId` — so the two surfaces can never drift in look or in what the e2e reads. Lifted
 * here so the class shape + the highlight wrap live in ONE place.
 *
 * The two layouts differ only by element + clamp depth, captured by `variant`:
 *   • 'block'  → a `<p>` clamped to TWO lines (the roomier grid card footer).
 *   • 'inline' → a `<span>` clamped to ONE line (the dense table cell).
 *
 * Pure presentation over the plain-text excerpt the engine extracted (the UI does the
 * highlighting, as React nodes — never raw HTML). An empty/whitespace snippet renders nothing
 * (`null`); the caller owns any em-dash placeholder for its own layout. Generic and i18n-free:
 * the `testId` is a prop so the caller owns the surface's e2e identity.
 */
export function SearchSnippet({
  snippet,
  term,
  variant,
  testId,
}: {
  /** The plain-text matched excerpt (e.g. `left(body, 160)` or the title). */
  snippet: string | null | undefined;
  /** The live query term — highlighted where it folds into the snippet. */
  term: string;
  variant: 'block' | 'inline';
  /** The `data-testid` both layouts share (so the e2e reads one identity). */
  testId: string;
}): React.ReactElement | null {
  if (!snippet) {
    return null;
  }
  const className =
    variant === 'block'
      ? 'text-muted-foreground line-clamp-2 text-xs'
      : 'text-muted-foreground line-clamp-1 text-xs';
  const content = <HighlightedText text={snippet} term={term} />;
  return variant === 'block' ? (
    <p className={className} data-testid={testId}>
      {content}
    </p>
  ) : (
    <span className={className} data-testid={testId}>
      {content}
    </span>
  );
}
