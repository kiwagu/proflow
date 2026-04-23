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
import { MongoClient } from 'mongodb';

import { mongoDatabaseNameFromUri } from './payload-mongo-user.js';
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

// ── MongoDB sweep (Payload Author mirror) ─────────────────────────────────────

export type MongoSweepResult = {
  orgsDeleted: number;
  spacesDeleted: number;
  usersDeleted: number;
  errors: string[];
};

/**
 * Remove e2e artifacts from Payload's MongoDB collections.
 * Author mirrors Supabase orgs/spaces/users via JetStream — leftover docs
 * accumulate when tests create orgs/spaces that get synced before teardown.
 *
 * Only runs when `mongoUrl` is provided (E2E_AUTHOR_MONGO_URL).
 */
export async function sweepE2EMongoArtifacts(
  mongoUrl: string
): Promise<MongoSweepResult> {
  const result: MongoSweepResult = {
    orgsDeleted: 0,
    spacesDeleted: 0,
    usersDeleted: 0,
    errors: [],
  };

  const client = await MongoClient.connect(mongoUrl);
  try {
    const db = client.db(mongoDatabaseNameFromUri(mongoUrl));

    // Organizations: name starts with "E2E" or slug starts with e2e/iso patterns
    const orgResult = await db.collection('organizations').deleteMany({
      $or: [
        { name: { $regex: /^E2E /i } },
        { slug: { $regex: /^(e2e-|iso-|a-iso|b-iso)/ } },
      ],
    });
    result.orgsDeleted = orgResult.deletedCount;

    // Spaces: slug starts with spc-/e2e/iso patterns
    const spaceResult = await db.collection('spaces').deleteMany({
      $or: [
        { name: { $regex: /^(E2E |Space [ab]$)/i } },
        { slug: { $regex: /^(spc-|e2e-|iso-)/ } },
      ],
    });
    result.spacesDeleted = spaceResult.deletedCount;

    // Users: email ends with @example.test
    const userResult = await db.collection('users').deleteMany({
      email: { $regex: /@example\.test$/ },
    });
    result.usersDeleted = userResult.deletedCount;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await client.close();
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

    const mongoUrl = process.env.E2E_AUTHOR_MONGO_URL;
    if (mongoUrl) {
      const m = await sweepE2EMongoArtifacts(mongoUrl);
      console.log('MongoDB (Payload) sweep:');
      console.log(`  orgs deleted:   ${m.orgsDeleted}`);
      console.log(`  spaces deleted: ${m.spacesDeleted}`);
      console.log(`  users deleted:  ${m.usersDeleted}`);
      if (m.errors.length > 0) {
        console.error('  errors:', m.errors);
      }
    } else {
      console.log(
        'MongoDB sweep: skipped (set E2E_AUTHOR_MONGO_URL to enable)'
      );
    }

    const allErrors = [...r.errors];
    if (allErrors.length > 0) process.exit(1);
  })();
}
