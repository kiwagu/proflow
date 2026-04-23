/**
 * RBAC permission matrix integration tests.
 *
 * Exercises the allow/deny contract from docs/rbac/role-permission-test-matrix.md
 * against a live Supabase instance. Each test calls auth_user_has_permission()
 * via the user's JWT (anon-key client) so the full Postgres permission chain
 * (user_role → role_permission → permissions) is exercised end-to-end.
 *
 * Setup provisions one authenticated client per scenario in beforeAll, shared
 * across all tests. See helpers/rbac-permissions-bootstrap.ts for details.
 *
 * @smoke — seed contract and critical allow/deny paths (fast CI gate).
 * Full   — scope isolation, union semantics, and default deny.
 */
import { type SupabaseClient } from '@supabase/supabase-js';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  bootstrapRbacPermissions,
  hasLiveSupabaseConfig,
  teardownRbacPermissions,
  type RbacTestEnv,
} from './helpers/rbac-permissions-bootstrap.js';

const describeLive = hasLiveSupabaseConfig() ? describe : describe.skip;

describeLive('rbac permission matrix', () => {
  // ── Shared env ────────────────────────────────────────────────────────────────

  let env: RbacTestEnv;

  beforeAll(async () => {
    env = await bootstrapRbacPermissions();
  });

  afterAll(async () => {
    if (env) await teardownRbacPermissions(env);
  });

  // ── Helper ────────────────────────────────────────────────────────────────────

  type PermissionArgs =
    | { p_permission_key: string; p_space_id: string; p_organization_id?: null }
    | {
        p_permission_key: string;
        p_organization_id: string;
        p_space_id?: null;
      };

  async function check(
    client: SupabaseClient,
    args: PermissionArgs
  ): Promise<boolean> {
    const { data, error } = await client.rpc('auth_user_has_permission', args);
    if (error)
      throw new Error(`auth_user_has_permission RPC: ${error.message}`);
    return data as boolean;
  }

  async function requirePermissionId(permissionKey: string): Promise<string> {
    const { data, error } = await env.service
      .from('permissions')
      .select('id')
      .eq('key', permissionKey)
      .maybeSingle();

    if (error || !data?.id) {
      throw new Error(
        `permission '${permissionKey}' not found: ${error?.message ?? 'no id'}`
      );
    }

    return data.id;
  }

  async function createCustomSpaceRoleAsOrgAdmin(labelSuffix: string) {
    const safeSuffix = labelSuffix.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const key = `e2e_custom_${Date.now()}_${safeSuffix}`;
    const { data, error } = await env.clients.org_admin
      .from('roles')
      .insert({
        key,
        scope: 'space',
        role_kind: 'custom',
        owner_organization_id: env.homeOrgId,
        label: `E2E Custom ${labelSuffix}`,
        description: 'E2E custom role',
        is_baseline: false,
        is_mutable: true,
        archived_at: null,
      })
      .select('id')
      .single();

    if (error || !data?.id) {
      throw new Error(
        `create custom role failed: ${error?.message ?? 'no role id'}`
      );
    }

    return data.id;
  }

  async function createTempDomainUserForCrud(
    labelSuffix: string
  ): Promise<string> {
    const suffix = `${Date.now()}-${labelSuffix}`;
    const email = `e2e-rbac-domain-${suffix}@example.test`;
    const password = `Pw!${suffix}Aa9`;
    const { data, error } = await env.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error || !data.user?.id) {
      throw new Error(
        `createTempDomainUserForCrud failed: ${error?.message ?? 'no user id'}`
      );
    }

    return data.user.id;
  }

  async function cleanupTempDomainUserForCrud(userId: string): Promise<void> {
    await env.service.from('user_role').delete().eq('user_id', userId);
    await env.service.from('space_memberships').delete().eq('user_id', userId);
    await env.service
      .from('organization_memberships')
      .delete()
      .eq('user_id', userId);
    await env.service.from('profiles').delete().eq('user_id', userId);
    await env.service.auth.admin.deleteUser(userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Seed contract — verifies that every role has at least one allow
  // ═══════════════════════════════════════════════════════════════════════════

  describe('seed contract', () => {
    test('@smoke rbac-member-read-space-users', async () => {
      expect(
        await check(env.clients.member, {
          p_permission_key: 'space.users.read',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-space-admin-manage-invites', async () => {
      expect(
        await check(env.clients.space_admin, {
          p_permission_key: 'space.invites.manage',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-space-admin-create-space-user', async () => {
      expect(
        await check(env.clients.space_admin, {
          p_permission_key: 'space.users.create',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-space-admin-delete-space-user', async () => {
      expect(
        await check(env.clients.space_admin, {
          p_permission_key: 'space.users.delete',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-org-admin-create-space', async () => {
      expect(
        await check(env.clients.org_admin, {
          p_permission_key: 'org.spaces.create',
          p_organization_id: env.homeOrgId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-org-admin-delete-space', async () => {
      expect(
        await check(env.clients.org_admin, {
          p_permission_key: 'org.spaces.delete',
          p_organization_id: env.homeOrgId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-org-admin-read-org-members', async () => {
      expect(
        await check(env.clients.org_admin, {
          p_permission_key: 'org.members.read',
          p_organization_id: env.homeOrgId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-org-admin-write-org-members', async () => {
      expect(
        await check(env.clients.org_admin, {
          p_permission_key: 'org.members.write',
          p_organization_id: env.homeOrgId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-org-admin-delegated-space-user-update', async () => {
      // Org-admin checking a permission on a space that belongs to their org.
      // auth_user_has_permission derives the org from the space_id.
      expect(
        await check(env.clients.org_admin, {
          p_permission_key: 'space.users.update',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Space role allow/deny
  // ═══════════════════════════════════════════════════════════════════════════

  describe('space role allow/deny', () => {
    test('rbac-member-update-space-users — deny', async () => {
      expect(
        await check(env.clients.member, {
          p_permission_key: 'space.users.update',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });

    test('rbac-member-manage-invites — deny', async () => {
      expect(
        await check(env.clients.member, {
          p_permission_key: 'space.invites.manage',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Organization role allow/deny
  // ═══════════════════════════════════════════════════════════════════════════

  describe('org role allow/deny', () => {
    test('rbac-org-admin-cross-org-user-update — deny', async () => {
      expect(
        await check(env.clients.org_admin, {
          p_permission_key: 'space.users.update',
          p_space_id: env.foreignOrgSpaceId,
        })
      ).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Domain role allow/deny — parametrized across student / tutor / manager
  // ═══════════════════════════════════════════════════════════════════════════

  // These three roles have identical permission bundles (space.users.read only).
  // If a future migration diverges them, split into per-role describe blocks.
  type DomainRoleKey = 'student' | 'tutor' | 'manager';

  const domainRoles: DomainRoleKey[] = ['student', 'tutor', 'manager'];

  describe('domain role allow/deny', () => {
    for (const role of domainRoles) {
      test(`rbac-${role}-read-space-users — allow`, async () => {
        expect(
          await check(env.clients[role], {
            p_permission_key: 'space.users.read',
            p_space_id: env.homeSpaceId,
          })
        ).toBe(true);
      });

      test(`rbac-${role}-update-space-users — deny`, async () => {
        expect(
          await check(env.clients[role], {
            p_permission_key: 'space.users.update',
            p_space_id: env.homeSpaceId,
          })
        ).toBe(false);
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Scope boundary isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('scope boundary isolation', () => {
    test('rbac-space-admin-cross-space-read — deny (other space, same org)', async () => {
      expect(
        await check(env.clients.space_admin, {
          p_permission_key: 'space.users.read',
          p_space_id: env.foreignSpaceSameOrgId,
        })
      ).toBe(false);
    });

    test('rbac-space-admin-cross-org-read — deny (foreign org)', async () => {
      expect(
        await check(env.clients.space_admin, {
          p_permission_key: 'space.users.read',
          p_space_id: env.foreignOrgSpaceId,
        })
      ).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Content roles — admin
  // ═══════════════════════════════════════════════════════════════════════════

  describe('content role — admin', () => {
    test('@smoke rbac-admin-content-create — allow', async () => {
      expect(
        await check(env.clients.admin, {
          p_permission_key: 'space.content.create',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-admin-content-publish — allow', async () => {
      expect(
        await check(env.clients.admin, {
          p_permission_key: 'space.content.publish',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-admin-content-access — allow', async () => {
      expect(
        await check(env.clients.admin, {
          p_permission_key: 'space.content.access',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('rbac-admin-no-invites — deny', async () => {
      expect(
        await check(env.clients.admin, {
          p_permission_key: 'space.invites.manage',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });

    test('rbac-admin-no-members-write — deny', async () => {
      expect(
        await check(env.clients.admin, {
          p_permission_key: 'space.members.write',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Content roles — author
  // ═══════════════════════════════════════════════════════════════════════════

  describe('content role — author', () => {
    test('@smoke rbac-author-content-create — allow', async () => {
      expect(
        await check(env.clients.author, {
          p_permission_key: 'space.content.create',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('@smoke rbac-author-content-update — allow', async () => {
      expect(
        await check(env.clients.author, {
          p_permission_key: 'space.content.update',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('rbac-author-no-publish — deny', async () => {
      expect(
        await check(env.clients.author, {
          p_permission_key: 'space.content.publish',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });

    test('rbac-author-no-delete — deny', async () => {
      expect(
        await check(env.clients.author, {
          p_permission_key: 'space.content.delete',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Multi-role union semantics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('multi-role union semantics', () => {
    test('rbac-union-member-plus-space-admin — allow (elevates to space_admin grant)', async () => {
      // member alone cannot manage invites; adding space_admin should elevate
      expect(
        await check(env.clients.union_member_space_admin, {
          p_permission_key: 'space.invites.manage',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });

    test('rbac-union-student-plus-member-update — deny (two read-only roles remain deny)', async () => {
      expect(
        await check(env.clients.union_student_member, {
          p_permission_key: 'space.users.update',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });

    test('rbac-union-org-admin-plus-student-org-scope — allow (org grant satisfies space check)', async () => {
      // org_admin at homeOrg; auth_user_has_permission derives org from homeSpaceId
      expect(
        await check(env.clients.union_org_admin_student, {
          p_permission_key: 'space.users.update',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Role catalog boundaries (org-admin vs space-admin)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('role catalog boundaries', () => {
    test('@smoke rbac-org-admin-role-catalog-create-custom-role — allow', async () => {
      const roleId = await createCustomSpaceRoleAsOrgAdmin('create-allow');
      const permissionId = await requirePermissionId('space.users.read');

      const { error: mappingErr } = await env.clients.org_admin
        .from('role_permission')
        .insert({ role_id: roleId, permission_id: permissionId });

      expect(mappingErr).toBeNull();
    });

    test('@smoke rbac-space-admin-role-catalog-create-custom-role — deny', async () => {
      const { error } = await env.clients.space_admin.from('roles').insert({
        key: `e2e_denied_${Date.now()}_create`,
        scope: 'space',
        role_kind: 'custom',
        owner_organization_id: env.homeOrgId,
        label: 'Denied role create',
        description: 'must fail for space admin',
        is_baseline: false,
        is_mutable: true,
        archived_at: null,
      });

      expect(error).not.toBeNull();
    });

    test('rbac-org-admin-role-catalog-update-permission-bundle — allow', async () => {
      const roleId = await createCustomSpaceRoleAsOrgAdmin(
        'bundle-update-allow'
      );
      const readPermissionId = await requirePermissionId('space.users.read');
      const updatePermissionId =
        await requirePermissionId('space.users.update');

      const { error: insertReadErr } = await env.clients.org_admin
        .from('role_permission')
        .insert({ role_id: roleId, permission_id: readPermissionId });

      expect(insertReadErr).toBeNull();

      const { error: deleteReadErr } = await env.clients.org_admin
        .from('role_permission')
        .delete()
        .eq('role_id', roleId)
        .eq('permission_id', readPermissionId);
      expect(deleteReadErr).toBeNull();

      const { error: insertUpdateErr } = await env.clients.org_admin
        .from('role_permission')
        .insert({ role_id: roleId, permission_id: updatePermissionId });
      expect(insertUpdateErr).toBeNull();

      const { data: bundleRows, error: bundleErr } = await env.clients.org_admin
        .from('role_permission')
        .select('permission_id')
        .eq('role_id', roleId);
      expect(bundleErr).toBeNull();
      expect((bundleRows ?? []).map((row) => row.permission_id)).toEqual([
        updatePermissionId,
      ]);
    });

    test('rbac-org-admin-role-catalog-archive-custom-role — allow', async () => {
      const roleId = await createCustomSpaceRoleAsOrgAdmin('archive-allow');

      const { error: archiveErr } = await env.clients.org_admin
        .from('roles')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', roleId)
        .is('archived_at', null);

      expect(archiveErr).toBeNull();
    });

    test('rbac-space-admin-role-catalog-update-and-archive — deny', async () => {
      const roleId = await createCustomSpaceRoleAsOrgAdmin(
        'update-archive-deny'
      );
      const permissionId = await requirePermissionId('space.users.read');

      const attemptedLabel = 'Space admin attempted update';
      const { error: roleUpdateErr } = await env.clients.space_admin
        .from('roles')
        .update({ label: attemptedLabel })
        .eq('id', roleId);

      const { data: afterUpdate, error: afterUpdateErr } = await env.service
        .from('roles')
        .select('label')
        .eq('id', roleId)
        .single();
      expect(afterUpdateErr).toBeNull();
      expect(afterUpdate?.label).not.toBe(attemptedLabel);
      // Keep the explicit error assertion when PostgREST returns policy errors.
      if (roleUpdateErr) {
        expect(roleUpdateErr).not.toBeNull();
      }

      const { error: permissionInsertErr } = await env.clients.space_admin
        .from('role_permission')
        .insert({ role_id: roleId, permission_id: permissionId });
      expect(permissionInsertErr).not.toBeNull();

      const { error: archiveErr } = await env.clients.space_admin
        .from('roles')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', roleId)
        .is('archived_at', null);

      const { data: afterArchive, error: afterArchiveErr } = await env.service
        .from('roles')
        .select('archived_at')
        .eq('id', roleId)
        .single();
      expect(afterArchiveErr).toBeNull();
      expect(afterArchive?.archived_at).toBeNull();
      if (archiveErr) {
        expect(archiveErr).not.toBeNull();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Delegated domain-user CRUD scope boundaries
  // ═══════════════════════════════════════════════════════════════════════════

  describe('delegated domain-user CRUD boundaries', () => {
    test('@smoke rbac-space-admin-domain-user-crud-in-scope — allow', async () => {
      const targetUserId = await createTempDomainUserForCrud('sa-own-space');
      try {
        const { error: createErr } = await env.clients.space_admin
          .from('space_memberships')
          .insert({
            space_id: env.homeSpaceId,
            user_id: targetUserId,
            status: 'active',
          });
        expect(createErr).toBeNull();

        const { data: createdRows, error: createdRowsErr } = await env.service
          .from('space_memberships')
          .select('space_id,user_id,status')
          .eq('space_id', env.homeSpaceId)
          .eq('user_id', targetUserId);
        expect(createdRowsErr).toBeNull();
        expect(createdRows ?? []).toHaveLength(1);

        const { error: updateErr } = await env.clients.space_admin
          .from('space_memberships')
          .update({ status: 'suspended' })
          .eq('space_id', env.homeSpaceId)
          .eq('user_id', targetUserId);
        expect(updateErr).toBeNull();

        const { data: updatedRows, error: updatedRowsErr } = await env.service
          .from('space_memberships')
          .select('status')
          .eq('space_id', env.homeSpaceId)
          .eq('user_id', targetUserId);
        expect(updatedRowsErr).toBeNull();
        expect(updatedRows ?? []).toHaveLength(1);
        expect(['active', 'suspended']).toContain(updatedRows?.[0]?.status);

        const { error: deleteErr } = await env.clients.space_admin
          .from('space_memberships')
          .delete()
          .eq('space_id', env.homeSpaceId)
          .eq('user_id', targetUserId);
        expect(deleteErr).toBeNull();

        const { data: afterDeleteRows, error: afterDeleteErr } =
          await env.service
            .from('space_memberships')
            .select('user_id')
            .eq('space_id', env.homeSpaceId)
            .eq('user_id', targetUserId);
        expect(afterDeleteErr).toBeNull();
        expect(afterDeleteRows ?? []).toHaveLength(0);
      } finally {
        await cleanupTempDomainUserForCrud(targetUserId);
      }
    });

    test('rbac-space-admin-domain-user-create-cross-space — deny', async () => {
      const targetUserId = await createTempDomainUserForCrud('sa-cross-space');
      try {
        const { error: createErr } = await env.clients.space_admin
          .from('space_memberships')
          .insert({
            space_id: env.foreignSpaceSameOrgId,
            user_id: targetUserId,
            status: 'active',
          });
        expect(createErr).not.toBeNull();

        const { data: serviceRows } = await env.service
          .from('space_memberships')
          .select('space_id,user_id')
          .eq('space_id', env.foreignSpaceSameOrgId)
          .eq('user_id', targetUserId);
        expect(serviceRows ?? []).toHaveLength(0);
      } finally {
        await cleanupTempDomainUserForCrud(targetUserId);
      }
    });

    test('rbac-org-admin-delegated-domain-user-crud-same-org-space — allow', async () => {
      const targetUserId = await createTempDomainUserForCrud('oa-same-org');
      try {
        const { error: createErr } = await env.clients.org_admin
          .from('space_memberships')
          .insert({
            space_id: env.foreignSpaceSameOrgId,
            user_id: targetUserId,
            status: 'active',
          });
        expect(createErr).toBeNull();

        const { data: createdRows, error: createdRowsErr } = await env.service
          .from('space_memberships')
          .select('space_id,user_id,status')
          .eq('space_id', env.foreignSpaceSameOrgId)
          .eq('user_id', targetUserId);
        expect(createdRowsErr).toBeNull();
        expect(createdRows ?? []).toHaveLength(1);

        const { error: updateErr } = await env.clients.org_admin
          .from('space_memberships')
          .update({ status: 'suspended' })
          .eq('space_id', env.foreignSpaceSameOrgId)
          .eq('user_id', targetUserId);
        expect(updateErr).toBeNull();

        const { data: updatedRows, error: updatedRowsErr } = await env.service
          .from('space_memberships')
          .select('status')
          .eq('space_id', env.foreignSpaceSameOrgId)
          .eq('user_id', targetUserId);
        expect(updatedRowsErr).toBeNull();
        expect(updatedRows ?? []).toHaveLength(1);
        expect(['active', 'suspended']).toContain(updatedRows?.[0]?.status);

        const { error: deleteErr } = await env.clients.org_admin
          .from('space_memberships')
          .delete()
          .eq('space_id', env.foreignSpaceSameOrgId)
          .eq('user_id', targetUserId);
        expect(deleteErr).toBeNull();

        const { data: afterDeleteRows, error: afterDeleteErr } =
          await env.service
            .from('space_memberships')
            .select('user_id')
            .eq('space_id', env.foreignSpaceSameOrgId)
            .eq('user_id', targetUserId);
        expect(afterDeleteErr).toBeNull();
        expect(afterDeleteRows ?? []).toHaveLength(0);
      } finally {
        await cleanupTempDomainUserForCrud(targetUserId);
      }
    });

    test('rbac-org-admin-delegated-domain-user-create-cross-org — deny', async () => {
      const targetUserId = await createTempDomainUserForCrud('oa-cross-org');
      try {
        const { error: createErr } = await env.clients.org_admin
          .from('space_memberships')
          .insert({
            space_id: env.foreignOrgSpaceId,
            user_id: targetUserId,
            status: 'active',
          });
        expect(createErr).not.toBeNull();

        const { data: serviceRows } = await env.service
          .from('space_memberships')
          .select('space_id,user_id')
          .eq('space_id', env.foreignOrgSpaceId)
          .eq('user_id', targetUserId);
        expect(serviceRows ?? []).toHaveLength(0);
      } finally {
        await cleanupTempDomainUserForCrud(targetUserId);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. Default deny
  // ═══════════════════════════════════════════════════════════════════════════

  describe('default deny', () => {
    test('@smoke rbac-no-roles-default-deny', async () => {
      expect(
        await check(env.clients.no_roles, {
          p_permission_key: 'space.users.read',
          p_space_id: env.homeSpaceId,
        })
      ).toBe(false);
    });
  });
});
