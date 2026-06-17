import type { Database } from '@workspace/db';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build the USER's RLS-scoped supabase-js client from the cookies on an inbound
 * request (the same construction as `lib/supabase/proxy.ts:242` and
 * `admin-payload-bridge/route.ts:65`). The client carries the user's Supabase
 * JWT, so Postgres RLS applies natively — this is the `db` argument the
 * projection engine and the fan-out module expect. NEVER service-role.
 *
 * Both the `/author/graph/*` endpoints and the `bodies` collection access
 * functions reach the graph through THIS, so the single access authority stays
 * Postgres RLS (ADR-0002 §2 / ADR-0005 §4). The cookie jar is read-only here:
 * endpoints/access functions never mutate the session (the proxy refreshes it).
 */

export function createRlsClientFromCookieHeader(
  cookieHeader: string | null
): SupabaseClient<Database> {
  // Reuse the SDK's own cookie-header parser instead of hand-rolling one: it is
  // the exact inverse of the `@supabase/ssr` chunk encoding the proxy writes, so
  // the JWT chunks round-trip byte-for-byte. Drop value-less cookies — the
  // cookie jar `getAll()` contract is `{ name, value }`.
  const cookies = (cookieHeader ? parseCookieHeader(cookieHeader) : [])
    .filter((c): c is { name: string; value: string } => c.value !== undefined)
    .map(({ name, value }) => ({ name, value }));
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookies;
        },
        // Read-only in endpoints/access paths: the proxy owns session refresh.
        setAll() {},
      },
    }
  );
}

export function createRlsClientFromRequest(
  request: Request
): SupabaseClient<Database> {
  return createRlsClientFromCookieHeader(request.headers.get('cookie'));
}
