import type { Database } from '@workspace/db';
import { createServerClient } from '@supabase/ssr';
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

function parseCookieHeader(
  cookieHeader: string | null
): { name: string; value: string }[] {
  if (!cookieHeader) {
    return [];
  }
  const out: { name: string; value: string }[] = [];
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name.length > 0) {
      out.push({ name, value });
    }
  }
  return out;
}

export function createRlsClientFromCookieHeader(
  cookieHeader: string | null
): SupabaseClient<Database> {
  const cookies = parseCookieHeader(cookieHeader);
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
