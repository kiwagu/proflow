/**
 * Framework-agnostic SORTERS — the ONE place ordering semantics live, usable from
 * ANY layer (web client, Node services, Payload hooks). Layer adapters wrap these:
 * the UI builds a TanStack `sortingFn` over them, and the data layer is expected to
 * mirror the SAME ordering in SQL when it owns the order (see NOTE).
 *
 * Human-friendly text ordering: case- and accent-insensitive, locale-aware, and
 * NUMERIC-natural ("World2" before "World10") — NOT raw code-point order (which
 * interleaves by UTF-8 value and puts all lowercase after all uppercase).
 *
 * NOTE (ordering contract / cross-layer consistency): when a server owns a list's
 * default order (e.g. a Postgres `ORDER BY`), it MUST match this contract — plain
 * Postgres collation does NOT. Mirror it with an ICU collation (case-insensitive,
 * `numeric`) so server-default order and client re-sorting never diverge. Deferred
 * until the server-ordering/pagination work; this comparator is the canonical
 * JS-side reference for it.
 */

// One shared collator — constructing one per comparison is expensive.
const TEXT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** Compare two strings the human way (see file header). Nullish sorts as empty. */
export function compareText(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  return TEXT_COLLATOR.compare(a ?? '', b ?? '');
}

/** Build a `compareText` comparator over a derived string key (e.g. `n => n.title`). */
export function byText<T>(key: (item: T) => string | null | undefined) {
  return (a: T, b: T): number => compareText(key(a), key(b));
}
