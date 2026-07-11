/**
 * Environment resolution for the seed engine — the SAME Supabase wiring the e2e
 * harness uses (E2E_* override → NEXT_PUBLIC_* → required), plus the author app
 * base URL the `/author/graph/*` endpoints are driven over. Kept dependency-free
 * so both the CLI and `@workspace/e2e` can import it.
 */

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function resolveSupabaseUrl(): string {
  return (
    process.env.E2E_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  );
}

export function resolveServiceRoleKey(): string {
  return (
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  );
}

export function resolveAnonKey(): string {
  return (
    process.env.E2E_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    requiredEnv('SUPABASE_ANON_KEY')
  );
}

/**
 * Base URL of the author app whose `/author/graph/*` endpoints the seed drives.
 * `SEED_BASE_URL` → `PLAYWRIGHT_BASE_URL` (shared with e2e) → the dev default.
 */
export function resolveBaseUrl(): string {
  return (
    process.env.SEED_BASE_URL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    'https://proflow.local'
  );
}
