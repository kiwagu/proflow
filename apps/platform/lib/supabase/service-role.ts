import 'server-only';

import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client for server-only flows (invite bootstrap, initial operator bootstrap,
 * admin reads bypassing RLS).
 * Never import from client components.
 */
export function createServiceRoleSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for server-side bootstrap flows.'
    );
  }
  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
