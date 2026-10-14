import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The SPA is a static bundle with no per-deployment build, so where its
 * replica talks to has to come from here. The subject of these cases is
 * exactly that: what the session answer carries, and what it withholds when
 * the server is not configured for replication.
 */

const getUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));

vi.mock('@/lib/active-space', () => ({
  listAccessibleSpacesForUser: vi.fn(async () => ({
    spaces: [{ id: 'spc_one.01m2', name: 'Space One' }],
  })),
  readActiveSpaceIdFromCookies: vi.fn(() => 'spc_one.01m2'),
  resolveActiveSpaceIdForAccessibleSpaces: vi.fn(() => 'spc_one.01m2'),
}));

vi.mock('@workspace/gateway-auth/active-space.cookie', () => ({
  setCanonicalActiveSpaceCookie: vi.fn(),
}));

vi.mock('@workspace/gateway-auth/password-recovery', () => ({
  PASSWORD_RECOVERY_COOKIE: 'sb-recovery',
}));

import { GET } from '@/app/api/workbench/session/route';

function request() {
  return {
    cookies: { get: () => undefined },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({
    data: { user: { id: 'u-1', email: 'user@example.test' } },
    error: null,
  });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
});

describe('the workbench session answer', () => {
  it('states where the replica talks to when the server is configured for it', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://server.test';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key';

    const body = await (await GET(request())).json();

    expect(body.sync).toEqual({
      url: 'https://server.test',
      key: 'publishable-key',
    });
  });

  it('withholds it when the server is not configured for replication', async () => {
    const body = await (await GET(request())).json();

    expect(body.sync).toBeUndefined();
    expect(body.userId).toBe('u-1');
  });

  it('withholds it when only half the configuration is present', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://server.test';

    const body = await (await GET(request())).json();

    expect(body.sync).toBeUndefined();
  });
});
