import type { Database } from '@workspace/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-service service-role Supabase client — the trusted background channel
 * this package's two workers share. Deliberately NOT a workspace-shared
 * helper: each service owns its trusted channel (same posture as the
 * notifications service).
 */
let cachedClient: SupabaseClient<Database> | null = null;

export function isServiceRoleSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createServiceRoleSupabaseClient(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is not configured');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}
