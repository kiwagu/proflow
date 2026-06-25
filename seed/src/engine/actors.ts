import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  resolveAnonKey,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from './env.js';

/** Service-role client — bypasses RLS (tenant/actor provisioning, assertions). */
export function serviceSupabase(): SupabaseClient {
  return createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** A short, collision-resistant slug for ephemeral org/space/user labels. */
export function slug(): string {
  return `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Sign in as `email`/`password` and return the RLS-scoped (user JWT) client. */
export async function authenticatedClient(
  email: string,
  password: string
): Promise<SupabaseClient> {
  const client = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`authenticatedClient(${email}): ${error.message}`);
  }
  return client;
}

/** Create a fresh confirmed auth user with a generated email/password. */
export async function createActor(
  service: SupabaseClient,
  label: string
): Promise<{ id: string; email: string; password: string }> {
  const suffix = `${label}-${slug()}`;
  const email = `seed-${suffix}@example.test`;
  const password = `Pw!${suffix}Aa9`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createActor(${label}): ${error?.message ?? 'no user'}`);
  }
  return { id: data.user.id, email, password };
}

/**
 * Idempotently ensure a confirmed auth user with a STABLE email/password (the
 * demo tenant's named users). If the user already exists, look it up by email
 * (paged `listUsers`) and return its id — the password is assumed unchanged from
 * the first provisioning. Used only by the demo tenant; ephemeral tenants use
 * `createActor` with random identities.
 */
export async function ensureActor(
  service: SupabaseClient,
  email: string,
  password: string
): Promise<{ id: string; email: string; password: string }> {
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.data?.user) {
    return { id: created.data.user.id, email, password };
  }
  // Already registered (or another create error) — resolve the existing user.
  const existing = await findUserByEmail(service, email);
  if (existing) {
    return { id: existing, email, password };
  }
  throw new Error(
    `ensureActor(${email}): ${created.error?.message ?? 'user not found after create'}`
  );
}

/** Resolve an EXISTING auth user's id by email (paged `listUsers`), or null. */
async function findUserByEmail(
  service: SupabaseClient,
  email: string
): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      throw new Error(`findUserByEmail(${email}): ${error.message}`);
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) {
      return match.id;
    }
    if (data.users.length < 200) {
      break;
    }
  }
  return null;
}

/** Resolve the system `admin` and `space_admin` role ids (knowledge verb carriers). */
export async function resolveRoleIds(
  service: SupabaseClient
): Promise<{ adminRoleId: string; spaceAdminRoleId: string }> {
  const { data, error } = await service
    .from('roles')
    .select('id,key')
    .eq('role_kind', 'system')
    .in('key', ['admin', 'space_admin']);
  if (error) {
    throw new Error(`resolveRoleIds: ${error.message}`);
  }
  const byKey = new Map((data ?? []).map((r) => [r.key, r.id]));
  const adminRoleId = byKey.get('admin');
  const spaceAdminRoleId = byKey.get('space_admin');
  if (!adminRoleId || !spaceAdminRoleId) {
    throw new Error(
      'resolveRoleIds: system roles admin/space_admin not found — knowledge perms unmapped'
    );
  }
  return { adminRoleId, spaceAdminRoleId };
}
