/**
 * The auth storage key supabase-js derives from a client URL, and so the
 * cookie name @supabase/ssr reads and writes: `sb-<first hostname label>-
 * auth-token`. Two clients built with different URLs (the platform with the
 * API host, the workbench with the same-origin backend prefix) only share a
 * session when the second one is told the first one's name.
 */
export function supabaseAuthStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}
