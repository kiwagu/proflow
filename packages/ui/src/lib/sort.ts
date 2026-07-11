import type { Row } from '@tanstack/react-table';
import { compareText } from '@workspace/std';

/**
 * UI sort adapter. The framework-agnostic comparator lives in `@workspace/std`
 * (shared with the data layer, no React/TanStack); here we only re-export it for
 * convenience and add the TanStack-specific `sortingFn`.
 */

export { compareText, byText } from '@workspace/std';

/**
 * TanStack `sortingFn` that orders a column's values with `compareText` — set it as
 * the table's `defaultColumn.sortingFn` so every text column sorts the human way
 * (case-insensitive, natural) without per-column wiring.
 */
export function textSortingFn<TData>(
  rowA: Row<TData>,
  rowB: Row<TData>,
  columnId: string
): number {
  return compareText(
    String(rowA.getValue(columnId) ?? ''),
    String(rowB.getValue(columnId) ?? '')
  );
}
