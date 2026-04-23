import type { Database } from '@workspace/db';
import { canAccessResource, RBAC_PERMISSION_KEYS } from '@workspace/rbac';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  bootstrapRbacPermissions,
  hasLiveSupabaseConfig,
  teardownRbacPermissions,
  type RbacTestEnv,
} from './helpers/rbac-permissions-bootstrap.js';

const describeLive = hasLiveSupabaseConfig() ? describe : describe.skip;

let env: RbacTestEnv;
const contentItemIdsBySpaceId = new Map<string, string>();

async function insertContentItem(
  service: SupabaseClient<Database>,
  input: {
    spaceId: string;
    title: string;
    createdBy: string;
    ownerUserId?: string;
  }
): Promise<string> {
  const { data, error } = await service
    .from('content_items')
    .insert({
      space_id: input.spaceId,
      title: input.title,
      status: 'active',
      visibility: 'space',
      created_by: input.createdBy,
      owner_user_id: input.ownerUserId ?? input.createdBy,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`insertContentItem: ${error?.message ?? 'missing id'}`);
  }

  return data.id;
}

describeLive('resource access', () => {
  beforeAll(async () => {
    env = await bootstrapRbacPermissions();

    const homeContentItemId = await insertContentItem(env.service, {
      spaceId: env.homeSpaceId,
      title: 'Home content item',
      createdBy: env.userIds[0]!,
    });
    contentItemIdsBySpaceId.set(env.homeSpaceId, homeContentItemId);

    const foreignSameOrgContentItemId = await insertContentItem(env.service, {
      spaceId: env.foreignSpaceSameOrgId,
      title: 'Foreign same-org content item',
      createdBy: env.userIds[0]!,
    });
    contentItemIdsBySpaceId.set(
      env.foreignSpaceSameOrgId,
      foreignSameOrgContentItemId
    );

    const foreignOrgContentItemId = await insertContentItem(env.service, {
      spaceId: env.foreignOrgSpaceId,
      title: 'Foreign org content item',
      createdBy: env.userIds[0]!,
    });
    contentItemIdsBySpaceId.set(env.foreignOrgSpaceId, foreignOrgContentItemId);
  });

  afterAll(async () => {
    if (env) {
      await teardownRbacPermissions(env);
    }
  });

  test('@smoke author can access own-space content helper and list results', async () => {
    await expect(
      canAccessResource(env.clients.author, {
        permissionKey: RBAC_PERMISSION_KEYS.spaceContentRead,
        spaceId: env.homeSpaceId,
      })
    ).resolves.toBe(true);

    const { data, error } = await env.clients.author
      .from('content_items')
      .select('id, title')
      .eq('space_id', env.homeSpaceId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.title).toBe('Home content item');
  });

  test('author cannot see foreign-space content', async () => {
    await expect(
      canAccessResource(env.clients.author, {
        permissionKey: RBAC_PERMISSION_KEYS.spaceContentRead,
        spaceId: env.foreignSpaceSameOrgId,
      })
    ).resolves.toBe(false);

    const { data, error } = await env.clients.author
      .from('content_items')
      .select('id, title')
      .eq('space_id', env.foreignSpaceSameOrgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test('@smoke member cannot insert content without create permission', async () => {
    const { error } = await env.clients.member.from('content_items').insert({
      space_id: env.homeSpaceId,
      title: 'Blocked member insert',
      status: 'draft',
      visibility: 'space',
      created_by: env.userIds[0]!,
      owner_user_id: env.userIds[0]!,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/row-level security|permission|policy/i);
  });

  test('org_admin without active space membership sees nothing', async () => {
    const { data, error } = await env.clients.org_admin
      .from('content_items')
      .select('id, title')
      .eq('space_id', env.homeSpaceId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test('role change updates access immediately for an existing session', async () => {
    const authorRoleId = env.roleIdsByKey.author;
    expect(authorRoleId).toBeDefined();
    if (!authorRoleId) {
      throw new Error('author role id missing from RBAC test bootstrap');
    }

    await expect(
      canAccessResource(env.clients.no_roles, {
        permissionKey: RBAC_PERMISSION_KEYS.spaceContentRead,
        spaceId: env.homeSpaceId,
      })
    ).resolves.toBe(false);

    const { error: insertError } = await env.service.from('user_role').insert({
      user_id: env.userIdsByScenario.no_roles,
      space_id: env.homeSpaceId,
      role_id: authorRoleId,
    });

    expect(insertError).toBeNull();

    await expect(
      canAccessResource(env.clients.no_roles, {
        permissionKey: RBAC_PERMISSION_KEYS.spaceContentRead,
        spaceId: env.homeSpaceId,
      })
    ).resolves.toBe(true);

    const { data, error } = await env.clients.no_roles
      .from('content_items')
      .select('id, title')
      .eq('space_id', env.homeSpaceId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.title).toBe('Home content item');
  });

  test('author cannot manage scopes without space.content.access', async () => {
    const { error } = await env.clients.author.from('scopes').insert({
      space_id: env.homeSpaceId,
      key: `author-no-access-${Date.now()}`,
      name: 'Blocked author scope mutation',
      created_by: env.userIdsByScenario.author,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/row-level security|permission|policy/i);
  });

  test('admin can manage scope links only inside their active space', async () => {
    const { data: scopeRow, error: scopeError } = await env.clients.admin
      .from('scopes')
      .insert({
        space_id: env.homeSpaceId,
        key: `admin-scope-${Date.now()}`,
        name: 'Admin scope',
        created_by: env.userIdsByScenario.admin,
      })
      .select('id')
      .single();

    expect(scopeError).toBeNull();
    expect(scopeRow?.id).toBeTruthy();

    const scopeId = scopeRow?.id;
    const contentItemId = contentItemIdsBySpaceId.get(env.homeSpaceId);
    expect(scopeId).toBeTruthy();
    expect(contentItemId).toBeTruthy();
    if (!scopeId || !contentItemId) {
      throw new Error(
        'Missing home scope or content item id for scope-link test'
      );
    }

    const { error: memberLinkError } = await env.clients.admin
      .from('scope_memberships')
      .insert({
        scope_id: scopeId,
        user_id: env.userIdsByScenario.author,
        created_by: env.userIdsByScenario.admin,
      });
    expect(memberLinkError).toBeNull();

    const { error: resourceLinkError } = await env.clients.admin
      .from('content_item_scopes')
      .insert({
        scope_id: scopeId,
        content_item_id: contentItemId,
        linked_by: env.userIdsByScenario.admin,
      });
    expect(resourceLinkError).toBeNull();

    const { error: foreignScopeError } = await env.clients.admin
      .from('scopes')
      .insert({
        space_id: env.foreignSpaceSameOrgId,
        key: `admin-foreign-${Date.now()}`,
        name: 'Forbidden foreign scope',
        created_by: env.userIdsByScenario.admin,
      });

    expect(foreignScopeError).not.toBeNull();
    expect(foreignScopeError?.message).toMatch(
      /row-level security|permission|policy/i
    );
  });
});
