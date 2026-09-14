import type { Database } from '@workspace/db';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { fetchRetryingGoaway } from './supabase-goaway-retry';

/**
 * New client per call (Fluid / serverless safe). Same pattern across gateway apps.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { fetch: fetchRetryingGoaway },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component without mutable cookies; edge/proxy refresh applies.
          }
        },
      },
    }
  );
}
