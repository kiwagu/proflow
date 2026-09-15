/**
 * Sweep all E2E artifacts from the database.
 *
 * All e2e users are created with @example.test emails (RFC 2606 reserved
 * domain — safe to bulk-delete). The sweep:
 *   1. Collects all auth.users with @example.test emails.
 *   2. Deletes space_invites created by them (ON DELETE RESTRICT).
 *   3. Deletes organizations whose slug starts with e2e/iso/a-iso/b-iso
 *      (cascades → spaces → space_memberships → organization_memberships).
 *   4. Deletes global system roles minted by the super-admin catalog spec
 *      (cascades → role_permission, user_role).
 *   5. Deletes profiles.
 *   6. Deletes auth users.
 *   7. Deletes outbox jobs addressed to e2e- recipients.
 *   8. Deletes fully orphaned audit rows on the local test stand only.
 *
 * Safe to run after any test run or standalone via:
 *   bun run --cwd tests/e2e test:e2e:db-sweep
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';

import { resolveServiceRoleKey, resolveSupabaseUrl } from './test-user.js';

const E2E_EMAIL_SUFFIX = '@example.test';
const E2E_ORG_SLUG_PREFIXES = ['e2e-', 'iso-', 'a-iso', 'b-iso'];

// Roles the super-admin catalog spec creates. The spec mints
// `key = e2e_global_<timestamp><token>`, and nothing else in the product
// writes a key under this prefix — the seeded catalog is a fixed eight
// (member, space_admin, org_admin, student, tutor, manager, admin, author).
// The underscore is escaped because it is a LIKE wildcard, so `e2ex_…` is not
// swept.
//
// `is_baseline = false` mirrors the table's own delete guard
// (`roles_enforce_mutation_guards` raises on a baseline delete), which turns a
// hypothetical prefix mistake into a no-op rather than a failed teardown.
// Measured on this stand, that belt is narrower than it looks: only 3 of the 8
// seeded roles are flagged baseline (member, space_admin, org_admin) — the
// other five are `is_baseline = false` and are protected by the key prefix
// alone. The prefix is the real selector; treat it as such when editing.
//
// Scope is deliberately NOT constrained: the catalog spec writes
// `scope = 'global'` today, but an org-scoped e2e role would leak the same way.
const E2E_ROLE_KEY_LIKE = 'e2e\\_%';

const execFileAsync = promisify(execFile);

async function sweepOrphanedAudit(): Promise<number> {
  const stackDirectory = fileURLToPath(
    new URL('../../../../infra/dev/supabase/', import.meta.url)
  ).replace(/\/$/, '');
  // Never inherit a remote Docker context: this bypass is test-stand-only.
  const dockerArgs = ['--host', 'unix:///var/run/docker.sock'];
  const { stdout: directory } = await execFileAsync(
    'docker',
    [
      ...dockerArgs,
      'inspect',
      '--format',
      '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
      'supabase-db',
    ],
    { timeout: 10_000 }
  );
  if (directory.trim() !== stackDirectory) {
    throw new Error(
      'Database container does not belong to this local test stand'
    );
  }
  const { POSTGRES_PASSWORD } = parse(
    await readFile(`${stackDirectory}/.env`, 'utf8')
  );
  if (!POSTGRES_PASSWORD) throw new Error('Test stand password is unavailable');

  // The product audit stays append-only. Only this transaction bypasses its
  // trigger, and only rows with ALL three parents gone are eligible.
  const { stdout } = await execFileAsync(
    'docker',
    [
      ...dockerArgs,
      'exec',
      '-e',
      'PGPASSWORD',
      'supabase-db',
      'psql',
      '-X',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atq',
      '-c',
      `begin;
       set local session_replication_role = replica;
       with deleted as (
         delete from public.space_admin_audit_log
         where organization_id is null
           and space_id is null
           and actor_user_id is null
         returning id
       ) select count(*) from deleted;
       commit;`,
    ],
    {
      env: { ...process.env, PGPASSWORD: POSTGRES_PASSWORD },
      timeout: 30_000,
    }
  );
  const count = Number(stdout.trim());
  if (!/^\d+$/.test(stdout.trim()) || !Number.isSafeInteger(count)) {
    throw new Error('Unexpected audit sweep count');
  }
  return count;
}

function serviceSupabase() {
  return createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SweepResult = {
  invitesDeleted: number;
  orgsDeleted: number;
  rolesDeleted: number;
  profilesDeleted: number;
  usersDeleted: number;
  outboxDeleted: number;
  auditDeleted: number;
  errors: string[];
};

export async function sweepE2EArtifacts(): Promise<SweepResult> {
  const supabase = serviceSupabase();
  const result: SweepResult = {
    invitesDeleted: 0,
    orgsDeleted: 0,
    rolesDeleted: 0,
    profilesDeleted: 0,
    usersDeleted: 0,
    outboxDeleted: 0,
    auditDeleted: 0,
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

  // ── 4. Delete e2e-minted roles (cascades role_permission, user_role) ─────
  // `space_invites.role_id` is ON DELETE NO ACTION, so this must run after
  // step 2 or a lingering invite would block the delete.
  const { count: roleCount, error: roleErr } = await supabase
    .from('roles')
    .delete({ count: 'exact' })
    .like('key', E2E_ROLE_KEY_LIKE)
    .eq('is_baseline', false);

  if (roleErr) {
    result.errors.push(`delete roles: ${roleErr.message}`);
  } else {
    result.rolesDeleted = roleCount ?? 0;
  }

  // ── 5. Delete profiles ────────────────────────────────────────────────────
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

  // ── 6. Delete auth users ──────────────────────────────────────────────────
  for (const userId of e2eUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      result.errors.push(`delete user ${userId}: ${error.message}`);
    } else {
      result.usersDeleted += 1;
    }
  }

  // ── 7. Outbox has no FK cascade; its recipient is the test marker ────────
  const { count: outboxCount, error: outboxErr } = await supabase
    .from('outbox_jobs')
    .delete({ count: 'exact' })
    .like('recipient', 'e2e-%');
  if (outboxErr) {
    result.errors.push(`delete outbox: ${outboxErr.message}`);
  } else {
    result.outboxDeleted = outboxCount ?? 0;
  }

  // ── 8. Last: org/space/user deletion must first null ALL audit FKs ───────
  try {
    result.auditDeleted = await sweepOrphanedAudit();
  } catch {
    // Child-process errors can carry credentials/environment details. Never
    // log them; teardown reports this bounded warning and keeps going.
    result.errors.push(
      'delete audit: local test database channel unavailable or sweep failed; audit cleanup not confirmed'
    );
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
    console.log(`  roles deleted:    ${r.rolesDeleted}`);
    console.log(`  profiles deleted: ${r.profilesDeleted}`);
    console.log(`  users deleted:    ${r.usersDeleted}`);
    console.log(`  outbox deleted:   ${r.outboxDeleted}`);
    console.log(`  audit deleted:    ${r.auditDeleted}`);
    if (r.errors.length > 0) {
      console.error('  errors:', r.errors);
    }

    const allErrors = [...r.errors];
    if (allErrors.length > 0) process.exit(1);
  })();
}
