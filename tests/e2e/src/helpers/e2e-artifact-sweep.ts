/**
 * Sweep all E2E artifacts from the database.
 *
 * All e2e users are created with @example.test emails (RFC 2606 reserved
 * domain — safe to bulk-delete). The sweep:
 *   1. Collects all auth.users with @example.test emails.
 *   2. Deletes space_invites created by them (ON DELETE RESTRICT).
 *   3. Deletes organizations whose slug starts with e2e/iso/a-iso/b-iso
 *      (cascades → spaces → space_memberships → organization_memberships).
 *   4. Deletes profiles.
 *   5. Deletes auth users.
 *
 * Safe to run after any test run or standalone via:
 *   npx tsx tests/e2e/src/helpers/e2e-artifact-sweep.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { resolveServiceRoleKey, resolveSupabaseUrl } from './test-user.js';

const E2E_EMAIL_SUFFIX = '@example.test';
const E2E_ORG_SLUG_PREFIXES = ['e2e-', 'iso-', 'a-iso', 'b-iso'];

function serviceSupabase() {
  return createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SweepResult = {
  invitesDeleted: number;
  orgsDeleted: number;
  profilesDeleted: number;
  usersDeleted: number;
  errors: string[];
};

export async function sweepE2EArtifacts(): Promise<SweepResult> {
  const supabase = serviceSupabase();
  const result: SweepResult = {
    invitesDeleted: 0,
    orgsDeleted: 0,
    profilesDeleted: 0,
    usersDeleted: 0,
    errors: [],
  };

  // ── 1. Collect all e2e user IDs via profiles (email stored there) ─────────
  const { data: e2eProfiles, error: profilesErr } = await supabase
    .from('profiles')
    .select('user_id, email')
    .like('email', `%${E2E_EMAIL_SUFFIX}`);

  if (profilesErr) {
    result.errors.push(`fetch profiles: ${profilesErr.message}`);
    return result;
  }

  const e2eUserIds = (e2eProfiles ?? []).map((p) => p.user_id as string);

  // ── 2. Delete space_invites created by e2e users for cleanup hygiene ─────
  if (e2eUserIds.length > 0) {
    const { count, error } = await supabase
      .from('space_invites')
      .delete({ count: 'exact' })
      .in('created_by_user_id', e2eUserIds);
    if (error) {
      result.errors.push(`delete invites: ${error.message}`);
    } else {
      result.invitesDeleted = count ?? 0;
    }
  }

  // ── 3. Delete e2e organizations (cascades spaces, memberships) ───────────
  // Build OR filter: slug ilike 'e2e-%' OR slug ilike 'iso-%' OR ...
  const slugFilters = E2E_ORG_SLUG_PREFIXES.map((p) => `slug.ilike.${p}%`).join(
    ','
  );
  const { count: orgCount, error: orgErr } = await supabase
    .from('organizations')
    .delete({ count: 'exact' })
    .or(slugFilters);

  if (orgErr) {
    result.errors.push(`delete orgs: ${orgErr.message}`);
  } else {
    result.orgsDeleted = orgCount ?? 0;
  }

  // ── 4. Delete profiles ────────────────────────────────────────────────────
  if (e2eUserIds.length > 0) {
    const { count, error } = await supabase
      .from('profiles')
      .delete({ count: 'exact' })
      .in('user_id', e2eUserIds);
    if (error) {
      result.errors.push(`delete profiles: ${error.message}`);
    } else {
      result.profilesDeleted = count ?? 0;
    }
  }

  // ── 5. Delete auth users ──────────────────────────────────────────────────
  for (const userId of e2eUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      result.errors.push(`delete user ${userId}: ${error.message}`);
    } else {
      result.usersDeleted += 1;
    }
  }

  return result;
}

// ── Standalone entry point ────────────────────────────────────────────────────

if (
  process.argv[1]?.endsWith('e2e-artifact-sweep.ts') ||
  process.argv[1]?.endsWith('e2e-artifact-sweep.js')
) {
  (async () => {
    const r = await sweepE2EArtifacts();
    console.log('Supabase sweep:');
    console.log(`  invites deleted:  ${r.invitesDeleted}`);
    console.log(`  orgs deleted:     ${r.orgsDeleted}`);
    console.log(`  profiles deleted: ${r.profilesDeleted}`);
    console.log(`  users deleted:    ${r.usersDeleted}`);
    if (r.errors.length > 0) {
      console.error('  errors:', r.errors);
    }

    const allErrors = [...r.errors];
    if (allErrors.length > 0) process.exit(1);
  })();
}
