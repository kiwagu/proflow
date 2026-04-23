import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';

import { requiredEnv } from './env.js';

export type SeededUser = {
  id: string;
  email: string;
  password: string;
};

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

function randomToken(): string {
  return Math.random().toString(36).slice(2, 12);
}

function describeSupabaseAuthError(error: unknown): string {
  if (error === null || error === undefined) {
    return '(no error object)';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === 'string' ? record.message.trim() : '';
    const status =
      typeof record.status === 'number' ? `status=${record.status}` : '';
    const code =
      record.code !== undefined && record.code !== null
        ? `code=${String(record.code)}`
        : '';
    const name = typeof record.name === 'string' ? `name=${record.name}` : '';
    const parts = [message, status, code, name].filter(Boolean);
    if (parts.length > 0) {
      return parts.join('; ');
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function isAuthUserMissingError(error: unknown): boolean {
  const message = describeSupabaseAuthError(error).toLowerCase();
  return message.includes('user not found');
}

export async function seedTestUser(): Promise<SeededUser> {
  const url = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();
  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = `${Date.now()}-${randomToken()}`;
  const email = `e2e-platform-${suffix}@example.test`;
  const password = `Pw!${suffix}Aa9`;
  const createResult = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createResult.error || !createResult.data.user) {
    const errText = describeSupabaseAuthError(createResult.error);
    const hint =
      'Use SUPABASE_SERVICE_ROLE_KEY (service_role JWT from Supabase dashboard or local secrets), not the anon/publishable key. NEXT_PUBLIC_SUPABASE_URL must match your running API (e.g. https://api.proflow.local).';
    throw new Error(
      `Failed to seed e2e user: ${errText}. ${createResult.data.user ? '' : 'No user in response. '}${hint}`
    );
  }

  return {
    id: createResult.data.user.id,
    email,
    password,
  };
}

export async function cleanupTestUser(userId: string): Promise<void> {
  const supabase = createClient<Database>(
    resolveSupabaseUrl(),
    resolveServiceRoleKey(),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  // Remove invites explicitly to keep e2e runs isolated.
  const deleteInvites = await supabase
    .from('space_invites')
    .delete()
    .eq('created_by_user_id', userId);
  if (deleteInvites.error) {
    throw new Error(
      `Failed to cleanup space_invites rows: ${deleteInvites.error.message}`
    );
  }

  // Clean profile row first in case FK is not cascading in local stack.
  const deleteProfile = await supabase
    .from('profiles')
    .delete()
    .eq('user_id', userId);
  if (deleteProfile.error) {
    throw new Error(
      `Failed to cleanup profile row: ${deleteProfile.error.message}`
    );
  }

  const deleteUser = await supabase.auth.admin.deleteUser(userId);
  if (deleteUser.error) {
    if (isAuthUserMissingError(deleteUser.error)) {
      return;
    }
    throw new Error(`Failed to cleanup e2e user: ${deleteUser.error.message}`);
  }
}
