import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@workspace/rbac/critical-capability', () => ({
  CRITICAL_CAPABILITY_KEYS: {
    platformAdminOverride: 'platform.admin.override',
  },
  hasCriticalCapability: vi.fn(),
}));

import { hasCriticalCapability } from '@workspace/rbac/critical-capability';

import { listAccessibleSpacesForUser } from '@/lib/active-space';

const hasCriticalCapabilityMock = vi.mocked(hasCriticalCapability);

function createOrderedQuery<T>(result: { data: T; error: unknown }) {
  return {
    select: vi.fn(() => ({
      order: vi.fn(async () => result),
    })),
  };
}

function createMembershipQuery<T>(result: { data: T; error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
  };

  return {
    select: vi.fn(() => query),
    query,
    resolve: vi.fn(async () => result),
  };
}

describe('listAccessibleSpacesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers membership spaces first for super-admin fallback ordering', async () => {
    hasCriticalCapabilityMock.mockResolvedValue(true);

    const spacesTable = createOrderedQuery({
      data: [
        {
          id: 'spc_seed',
          name: 'Seed Space Alpha',
          slug: 'seed-space-alpha',
          avatar_url: null,
          organization_id: 'org_seed',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'spc_third',
          name: 'Third Space',
          slug: 'third-space',
          avatar_url: null,
          organization_id: 'org_third',
          created_at: '2026-04-20T00:00:00Z',
        },
      ],
      error: null,
    });

    const membershipQuery = {
      eq: vi.fn().mockReturnThis(),
    };
    membershipQuery.eq.mockReturnValueOnce(membershipQuery).mockReturnValueOnce(
      Promise.resolve({
        data: [{ space_id: 'spc_third' }],
        error: null,
      })
    );

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'spaces') {
          return spacesTable;
        }

        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => membershipQuery),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never;

    const result = await listAccessibleSpacesForUser(supabase, 'user-1');

    expect(result.isSuperAdmin).toBe(true);
    expect(result.spaces.map((space) => space.id)).toEqual([
      'spc_third',
      'spc_seed',
    ]);
  });
});
