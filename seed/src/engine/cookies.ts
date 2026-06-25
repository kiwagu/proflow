import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

import { resolveAnonKey, resolveSupabaseUrl } from './env.js';
import type { SeedActor } from './types.js';

/**
 * Replay an actor's session through `@supabase/ssr`'s OWN `createServerClient`
 * against an in-memory cookie jar, so the cookies are serialized in the byte-exact
 * name + base64url chunk encoding the author proxy / `/author/graph/*` endpoints
 * decode. This is how an actor is driven over HTTP under their real RLS session.
 */
export async function actorSsrAuthCookies(
  actor: SeedActor
): Promise<{ name: string; value: string }[]> {
  // 1. Programmatic sign-in to obtain a session.
  const signer = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await signer.auth.signInWithPassword({
    email: actor.email,
    password: actor.password,
  });
  if (error || !data.session) {
    throw new Error(`actorSsrAuthCookies: ${error?.message ?? 'no session'}`);
  }

  // 2. Replay the session through @supabase/ssr so it serializes the cookies in
  //    the exact format the author proxy/endpoints decode (name + base64url).
  const jar = new Map<string, string>();
  const ssr = createServerClient(resolveSupabaseUrl(), resolveAnonKey(), {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet: { name: string; value: string }[]) {
        for (const { name, value } of cookiesToSet) {
          jar.set(name, value);
        }
      },
    },
  });
  await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  if (jar.size === 0) {
    throw new Error('actorSsrAuthCookies: ssr wrote no cookies');
  }
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

/** The `Cookie:` header value carrying an actor's SSR auth session. */
export async function actorCookieHeader(actor: SeedActor): Promise<string> {
  const cookies = await actorSsrAuthCookies(actor);
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
