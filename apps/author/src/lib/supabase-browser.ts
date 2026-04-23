import type { Database } from '@workspace/db';
import { createBrowserSupabaseClient } from '@workspace/gateway-auth/supabase/browser';
import type { SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient<Database> | null = null;

/**
 * Single Supabase browser client per tab (Strict Mode / HMR).
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!browserClient) {
    browserClient = createBrowserSupabaseClient();
  }
  return browserClient;
}

function getLegacyStorageKey(url: string): string {
  const host = new URL(url).hostname;
  return `sb-${host}-auth-token`;
}

/**
 * Clears leftover keys from older `@supabase/supabase-js` localStorage sessions.
 */
export function clearSupabaseBrowserSession(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    return;
  }
  const key = getLegacyStorageKey(url);
  window.localStorage.removeItem(key);
  window.sessionStorage.removeItem(key);
}
