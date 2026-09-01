/**
 * @file Opening a URL that came out of user content.
 *
 * Editor content can carry arbitrary links, and where they should open is the
 * host app's decision, not the editor's: a link to a document inside the
 * workspace should route in-app, an outside link should leave. So the editor
 * never calls `window.open` directly — it calls {@link openExternalUrl}, and
 * the host registers an interceptor to claim the URLs it recognises. Anything
 * unclaimed opens in a new tab with the opener detached.
 */

/**
 * Handles a URL before the default new-tab behaviour. Returns true when it
 * took ownership of the URL, in which case no further handling runs.
 */
export type ExternalUrlInterceptor = (url: string) => boolean;

// Insertion-ordered; a Set dedupes a handler registered more than once (e.g.
// if the registering component remounts).
const externalUrlInterceptors = new Set<ExternalUrlInterceptor>();

/**
 * Registers a handler consulted by {@link openExternalUrl} before its default
 * handling. Interceptors are tried in registration order and the first to
 * return true takes ownership of the URL.
 *
 * @returns a function that unregisters the interceptor.
 */
export function registerExternalUrlInterceptor(
  interceptor: ExternalUrlInterceptor
): () => void {
  externalUrlInterceptors.add(interceptor);
  return () => {
    externalUrlInterceptors.delete(interceptor);
  };
}

/**
 * The single entry point for opening a URL from user content or UI actions —
 * use this instead of `window.open`. Registered interceptors are tried first,
 * in registration order, and the first to claim the URL wins; anything left
 * over opens in a new tab.
 */
export function openExternalUrl(url: string): void {
  for (const interceptor of externalUrlInterceptors) {
    if (interceptor(url)) return;
  }

  window.open(url, '_blank', 'noopener,noreferrer')?.focus();
}
