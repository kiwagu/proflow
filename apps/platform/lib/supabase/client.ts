import type { Database } from '@workspace/db';
import { createBrowserSupabaseClient } from '@workspace/gateway-auth/supabase/browser';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createClient(): SupabaseClient<Database> {
  const client = createBrowserSupabaseClient();
  if (!client) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    );
  }
  return client;
}
