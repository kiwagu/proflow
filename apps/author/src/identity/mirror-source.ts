import { createClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';

/**
 * Mirror-source helpers — the SINGLE way the author resolves a Supabase user's STABLE
 * mirror identity (`public.profiles.entity_id`) from its auth `sub`. Both the JetStream
 * identity worker (`identity.lifecycle.apply` / `space-org.lifecycle.apply`) and the JIT
 * admin-payload-bridge create the Payload `users` doc keyed by this SAME `entity_id`, so
 * they can never diverge. `profiles.entity_id` is the canonical mirror key (per the
 * identity-sync rule); a Payload user id is ALWAYS that value, never minted ad hoc —
 * the `users` collection runs `customIdPlugin` in `validate` mode (an id MUST be supplied
 * on create).
 */

/** A service-role Supabase client (RLS-bypassing) for reading the mirror source, or
 * `null` when the env is not configured. */
export function serviceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRole) {
    return null;
  }
  return createClient<Database>(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve the stable Payload-user id (`profiles.entity_id`) for a Supabase `sub`. Throws
 * loudly when the mirror source is missing or has no `entity_id` — we never invent a
 * divergent id (that would break the one-id-per-identity invariant the worker enforces).
 */
export async function resolveMirrorEntityId(sub: string): Promise<string> {
  const supabase = serviceSupabaseClient();
  if (!supabase) {
    throw new Error(
      'mirror-source: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is missing'
    );
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('entity_id')
    .eq('user_id', sub)
    .maybeSingle<{ entity_id: string | null }>();
  const entityId = data?.entity_id?.trim();
  if (error || !entityId) {
    throw new Error(
      `mirror-source: inconsistent mirror for supabaseSub=${sub}: missing profiles.entity_id`
    );
  }
  return entityId;
}
