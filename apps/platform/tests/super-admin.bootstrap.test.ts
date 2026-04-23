import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('server-only', () => ({}));

vi.mock('@workspace/rbac/critical-capability', () => ({
  CRITICAL_CAPABILITY_KEYS: {
    platformAdminOverride: 'platform.admin.override',
  },
  hasCriticalCapability: vi.fn(),
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));

import { hasCriticalCapability } from '@workspace/rbac/critical-capability';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import {
  ensureInitialPlatformSuperAdminForUser,
  getConfiguredInitialPlatformSuperAdminEmail,
} from '@/lib/super-admin.bootstrap.server';

const hasCriticalCapabilityMock = vi.mocked(hasCriticalCapability);
const createServiceRoleSupabaseClientMock = vi.mocked(
  createServiceRoleSupabaseClient
);
const originalNodeEnv = process.env.NODE_ENV;
const env = process.env as Record<string, string | undefined>;

describe('initial platform super-admin bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.NODE_ENV = 'test';
    delete env.PLATFORM_INITIAL_SUPER_ADMIN_EMAIL;
    createServiceRoleSupabaseClientMock.mockReturnValue({
      rpc: rpcMock,
    } as never);
    hasCriticalCapabilityMock.mockResolvedValue(false);
    rpcMock.mockResolvedValue({
      data: { ok: true, status: 'granted', grant_id: 'ocg_1' },
      error: null,
    });
  });

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
  });

  it('returns null when bootstrap email is not configured', () => {
    expect(getConfiguredInitialPlatformSuperAdminEmail()).toBeNull();
  });

  it('normalizes the configured bootstrap email', () => {
    env.PLATFORM_INITIAL_SUPER_ADMIN_EMAIL = '  Admin@Example.com ';

    expect(getConfiguredInitialPlatformSuperAdminEmail()).toBe(
      'admin@example.com'
    );
  });

  it('skips bootstrap when the signed-in user email does not match', async () => {
    env.PLATFORM_INITIAL_SUPER_ADMIN_EMAIL = 'admin@example.com';

    await ensureInitialPlatformSuperAdminForUser({} as never, {
      id: 'user-1',
      email: 'member@example.com',
    });

    expect(hasCriticalCapabilityMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('skips bootstrap when the user already has the capability', async () => {
    env.PLATFORM_INITIAL_SUPER_ADMIN_EMAIL = 'admin@example.com';
    hasCriticalCapabilityMock.mockResolvedValue(true);

    await ensureInitialPlatformSuperAdminForUser({} as never, {
      id: 'user-1',
      email: 'admin@example.com',
    });

    expect(hasCriticalCapabilityMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('calls the sealed bootstrap rpc for the configured email', async () => {
    env.PLATFORM_INITIAL_SUPER_ADMIN_EMAIL = 'admin@example.com';

    await ensureInitialPlatformSuperAdminForUser({} as never, {
      id: 'user-1',
      email: 'Admin@example.com',
    });

    expect(rpcMock).toHaveBeenCalledWith(
      'rpc_bootstrap_initial_platform_super_admin',
      {
        p_user_id: 'user-1',
        p_expected_email: 'admin@example.com',
        p_reason: 'Configured env bootstrap',
      }
    );
  });

  it('throws when bootstrap rpc fails', async () => {
    env.PLATFORM_INITIAL_SUPER_ADMIN_EMAIL = 'admin@example.com';
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      ensureInitialPlatformSuperAdminForUser({} as never, {
        id: 'user-1',
        email: 'admin@example.com',
      })
    ).rejects.toThrow('Could not bootstrap the initial platform super admin.');
  });
});
