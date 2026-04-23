import type { Database } from '@workspace/db';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Cookie-backed browser client (`@supabase/ssr`). Create a new instance per call
 * or wrap in a singleton in the app if you must dedupe GoTrue in Strict Mode.
 */
export function createBrowserSupabaseClient() {
  if (typeof window === 'undefined') {
    return null;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createBrowserClient<Database>(url, key);
}
