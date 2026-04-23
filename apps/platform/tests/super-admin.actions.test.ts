import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/space-invite.auth-lookup.server', () => ({
  resolveAuthUserByEmail: vi.fn(),
}));

vi.mock('@workspace/rbac/critical-capability', () => ({
  CRITICAL_CAPABILITY_KEYS: {
    platformAdminOverride: 'platform.admin.override',
  },
  hasCriticalCapability: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/platform-revalidate', () => ({
  revalidatePlatformPath: vi.fn(),
}));

import { hasCriticalCapability } from '@workspace/rbac/critical-capability';
import { cookies } from 'next/headers';
import { revalidatePlatformPath } from '@/lib/platform-revalidate';
import { createGlobalSystemRoleAction } from '@/lib/platform-role-catalog.actions';
import {
  grantPlatformSuperAdminAction,
  revokePlatformSuperAdminAction,
} from '@/lib/platform-super-admin.actions';
import { resolveAuthUserByEmail } from '@/lib/space-invite.auth-lookup.server';
import { setActiveSpaceAction } from '@/lib/space.active.actions';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';

function mockSupabaseUser(id = 'user-1') {
  return {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-04-01T00:00:00Z',
  };
}

function mockAuthenticatedClient(
  overrides: Record<string, unknown> = {}
): never {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockSupabaseUser() },
        error: null,
      })),
    },
    ...overrides,
  } as never;
}

function mockCookieStore(currentValue?: string): never {
  return {
    get: vi.fn((name: string) =>
      currentValue ? { name, value: currentValue } : undefined
    ),
    set: vi.fn(),
  } as never;
}

function mockCookieStoreWithSet(
  set: ReturnType<typeof vi.fn>,
  currentValue?: string
): never {
  return {
    get: vi.fn((name: string) =>
      currentValue ? { name, value: currentValue } : undefined
    ),
    set,
  } as never;
}

const createClientMock = vi.mocked(createClient);
const createServiceRoleSupabaseClientMock = vi.mocked(
  createServiceRoleSupabaseClient
);
const hasCriticalCapabilityMock = vi.mocked(hasCriticalCapability);
const cookiesMock = vi.mocked(cookies);
const revalidatePlatformPathMock = vi.mocked(revalidatePlatformPath);
const resolveAuthUserByEmailMock = vi.mocked(resolveAuthUserByEmail);

function createMembershipQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };

  return {
    select: vi.fn(() => query),
  };
}

function createPermissionsQuery(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn(() => ({
      in: vi.fn(async () => result),
    })),
  };
}

function createSpaceQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };

  return {
    select: vi.fn(() => query),
  };
}

describe('super-admin action gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue(mockCookieStore());
  });

  it('denies global system-role creation without the critical capability path', async () => {
    createClientMock.mockResolvedValue(mockAuthenticatedClient());
    hasCriticalCapabilityMock.mockResolvedValue(false);

    const result = await createGlobalSystemRoleAction({
      key: 'support_operator',
      label: 'Support operator',
      description: 'Cross-organization support role.',
      permissionKeys: ['space.users.read'],
      confirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      message: 'Not allowed to manage global system roles.',
    });
  });

  it('creates a global system role when critical capability is present', async () => {
    const permissionsTable = createPermissionsQuery({
      data: [{ id: 'prm_01', key: 'space.users.read' }],
      error: null,
    });

    const fromMock = vi.fn((table: string) => {
      if (table === 'permissions') {
        return permissionsTable;
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const rpcMock = vi.fn(async () => ({
      data: 'rol_0123456789abcdef.0123456789',
      error: null,
    }));

    createClientMock.mockResolvedValue(
      mockAuthenticatedClient({
        from: fromMock,
        rpc: rpcMock,
      })
    );
    hasCriticalCapabilityMock.mockResolvedValue(true);

    const result = await createGlobalSystemRoleAction({
      key: 'support_operator',
      label: 'Support operator',
      description: 'Cross-organization support role.',
      permissionKeys: ['space.users.read'],
      confirmed: true,
    });

    expect(result).toEqual({
      ok: true,
      roleId: 'rol_0123456789abcdef.0123456789',
    });
    expect(rpcMock).toHaveBeenCalledWith('rpc_create_global_system_role', {
      p_key: 'support_operator',
      p_label: 'Support operator',
      p_description: 'Cross-organization support role.',
      p_permission_keys: ['space.users.read'],
    });
    expect(revalidatePlatformPathMock).toHaveBeenCalledWith('/ops');
  });

  it('denies platform super-admin grants without the critical capability path', async () => {
    createClientMock.mockResolvedValue(mockAuthenticatedClient());
    hasCriticalCapabilityMock.mockResolvedValue(false);

    const result = await grantPlatformSuperAdminAction({
      email: 'operator@example.com',
      reason: 'Coverage for cross-org incidents.',
      confirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      message: 'Not allowed to grant platform super admin.',
    });
  });

  it('rejects platform super-admin grants for missing auth users', async () => {
    createClientMock.mockResolvedValue(mockAuthenticatedClient());
    createServiceRoleSupabaseClientMock.mockReturnValue({} as never);
    hasCriticalCapabilityMock.mockResolvedValue(true);
    resolveAuthUserByEmailMock.mockResolvedValue(null);

    const result = await grantPlatformSuperAdminAction({
      email: 'missing@example.com',
      reason: 'Coverage for cross-org incidents.',
      confirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      message: 'User must already exist before granting platform super admin.',
    });
  });

  it('grants platform super admin through the authenticated rpc path', async () => {
    const rpcMock = vi.fn(async () => ({
      data: { ok: true, status: 'granted', grant_id: 'grant_01' },
      error: null,
    }));

    createClientMock.mockResolvedValue(
      mockAuthenticatedClient({ rpc: rpcMock })
    );
    createServiceRoleSupabaseClientMock.mockReturnValue({} as never);
    hasCriticalCapabilityMock.mockResolvedValue(true);
    resolveAuthUserByEmailMock.mockResolvedValue({
      id: 'target-user-1',
      email: 'operator@example.com',
      last_sign_in_at: '2026-04-11T12:00:00Z',
    });

    const result = await grantPlatformSuperAdminAction({
      email: 'operator@example.com',
      reason: 'Coverage for cross-org incidents.',
      confirmed: true,
    });

    expect(result).toEqual({ ok: true, status: 'granted' });
    expect(rpcMock).toHaveBeenCalledWith('rpc_grant_platform_super_admin', {
      p_target_user_id: 'target-user-1',
      p_reason: 'Coverage for cross-org incidents.',
    });
    expect(revalidatePlatformPathMock).toHaveBeenCalledWith('/ops');
  });

  it('surfaces the hard cap when platform super-admin capacity is full', async () => {
    const rpcMock = vi.fn(async () => ({
      data: null,
      error: {
        message: 'No more than 3 active platform super admins allowed',
      },
    }));

    createClientMock.mockResolvedValue(
      mockAuthenticatedClient({ rpc: rpcMock })
    );
    createServiceRoleSupabaseClientMock.mockReturnValue({} as never);
    hasCriticalCapabilityMock.mockResolvedValue(true);
    resolveAuthUserByEmailMock.mockResolvedValue({
      id: 'target-user-1',
      email: 'operator@example.com',
      last_sign_in_at: '2026-04-11T12:00:00Z',
    });

    const result = await grantPlatformSuperAdminAction({
      email: 'operator@example.com',
      reason: 'Coverage for cross-org incidents.',
      confirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      message: 'No more than 3 active platform super admins are allowed.',
    });
  });

  it('denies platform super-admin revoke without the critical capability path', async () => {
    createClientMock.mockResolvedValue(mockAuthenticatedClient());
    hasCriticalCapabilityMock.mockResolvedValue(false);

    const result = await revokePlatformSuperAdminAction({
      userId: '123e4567-e89b-12d3-a456-426614174000',
      reason: 'Remove elevated access.',
      confirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      message: 'Not allowed to revoke platform super admin.',
    });
  });

  it('revokes platform super admin through the authenticated rpc path', async () => {
    const rpcMock = vi.fn(async () => ({
      data: { ok: true, status: 'revoked', grant_id: 'grant_01' },
      error: null,
    }));

    createClientMock.mockResolvedValue(
      mockAuthenticatedClient({ rpc: rpcMock })
    );
    hasCriticalCapabilityMock.mockResolvedValue(true);

    const result = await revokePlatformSuperAdminAction({
      userId: '123e4567-e89b-12d3-a456-426614174000',
      reason: 'Remove elevated access.',
      confirmed: true,
    });

    expect(result).toEqual({ ok: true, status: 'revoked' });
    expect(rpcMock).toHaveBeenCalledWith('rpc_revoke_platform_super_admin', {
      p_target_user_id: '123e4567-e89b-12d3-a456-426614174000',
      p_reason: 'Remove elevated access.',
    });
    expect(revalidatePlatformPathMock).toHaveBeenCalledWith('/ops');
  });

  it('surfaces the last-active guard during platform super-admin revoke', async () => {
    const rpcMock = vi.fn(async () => ({
      data: null,
      error: {
        message: 'At least 1 active platform super admin is required',
      },
    }));

    createClientMock.mockResolvedValue(
      mockAuthenticatedClient({ rpc: rpcMock })
    );
    hasCriticalCapabilityMock.mockResolvedValue(true);

    const result = await revokePlatformSuperAdminAction({
      userId: '123e4567-e89b-12d3-a456-426614174000',
      reason: 'Remove elevated access.',
      confirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      message: 'At least 1 active platform super admin is required.',
    });
  });

  it('denies privileged space switching for non-members without critical capability', async () => {
    const membershipTable = createMembershipQuery({
      data: null,
      error: null,
    });

    createClientMock.mockResolvedValue(
      mockAuthenticatedClient({
        from: vi.fn((table: string) => {
          if (table === 'space_memberships') {
            return membershipTable;
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
      })
    );
    hasCriticalCapabilityMock.mockResolvedValue(false);

    const result = await setActiveSpaceAction('spc_target');

    expect(result).toEqual({
      ok: false,
      message: 'Not a member of this space.',
    });
  });

  it('allows audited cross-org support switching with critical capability', async () => {
    const membershipTable = createMembershipQuery({
      data: null,
      error: null,
    });
    const spacesTable = createSpaceQuery({
      data: {
        id: 'spc_target',
        organization_id: 'org_target',
      },
      error: null,
    });
    const auditInsertMock = vi.fn(async () => ({ error: null }));
    const cookieSetMock = vi.fn();

    cookiesMock.mockResolvedValue(
      mockCookieStoreWithSet(cookieSetMock, 'spc_previous')
    );

    createClientMock.mockResolvedValue(
      mockAuthenticatedClient({
        from: vi.fn((table: string) => {
          if (table === 'space_memberships') {
            return membershipTable;
          }
          if (table === 'spaces') {
            return spacesTable;
          }
          if (table === 'space_admin_audit_log') {
            return {
              insert: auditInsertMock,
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
      })
    );
    hasCriticalCapabilityMock.mockResolvedValue(true);

    const result = await setActiveSpaceAction('spc_target');

    expect(result).toEqual({ ok: true });
    expect(auditInsertMock).toHaveBeenCalledWith({
      actor_user_id: 'user-1',
      action: 'support.space_context.switch',
      entity_type: 'support_context',
      entity_id: 'spc_target',
      organization_id: 'org_target',
      space_id: 'spc_target',
      request_id: null,
      previous_value: { active_space_id: 'spc_previous' },
      new_value: { active_space_id: 'spc_target' },
    });
    expect(revalidatePlatformPathMock).toHaveBeenCalledWith('/space-settings');
  });
});
