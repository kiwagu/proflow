/**
 * formatWhen — the "For you" sort timestamp shown on the home digest cards (opened /
 * updated time). Locale/timezone-dependent, so the view renders it CLIENT-ONLY (the
 * `mounted` gate) to avoid an SSR/hydration mismatch.
 */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
