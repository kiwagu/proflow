import type { Database } from '@workspace/db';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Server-component mirror of `rls-from-request.ts`: build the USER's RLS-scoped
 * supabase-js client from the request cookies via `next/headers`. The client
 * carries the user's Supabase JWT, so Postgres RLS applies natively — this is the
 * `db` the projection resolver expects. NEVER service-role.
 *
 * Both the `/author/graph/*` route handlers (slice-03, via `Request`) and the
 * `/author/graph/*` server pages (slice-04, via `cookies()`) reach the graph
 * through an RLS-scoped client, so the single access authority stays Postgres
 * RLS (ADR-0003 §2 / ADR-0005 §4). The cookie jar is read-only here: the proxy
 * owns session refresh (`setAll` is a no-op).
 */
export async function createRlsClientFromServerCookies(): Promise<
  SupabaseClient<Database>
> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // Read-only on render pages: the proxy owns session refresh.
        setAll() {},
      },
    }
  );
}
