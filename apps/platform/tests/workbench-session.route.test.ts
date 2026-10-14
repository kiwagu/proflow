import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The SPA is a static bundle with no per-deployment build, so where its
 * replica talks to has to come from here. The subject of these cases is
 * exactly that: what the session answer carries, and what it withholds when
 * the server is not configured for replication.
 */

const getUser = vi.fn();
const rpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
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

import type { WriteScope } from '@workspace/knowledge-contracts';
import { GET } from '@/app/api/workbench/session/route';

/** What the database states for a member: their own nodes, and stars. */
const SCOPE: WriteScope = {
  'node.create': 'all',
  'node.update': { own: ['owner_user_id'] },
  'node.move': { own: ['parent_edge_created_by'] },
  'node.trash': { own: ['owner_user_id'] },
  'node.purge': 'none',
  'node.star': 'all',
  'body.write': { own: ['owner_user_id'] },
};

function request(headers: Record<string, string> = {}) {
  return {
    cookies: { get: () => undefined },
    headers: new Headers(headers),
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({
    data: { user: { id: 'u-1', email: 'user@example.test' } },
    error: null,
  });
  rpc.mockResolvedValue({ data: null, error: null });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // The public origin is configured per case; one inherited from the shell
  // would decide the url instead of the case.
  vi.stubEnv('NEXT_PUBLIC_GATEWAY_ORIGIN', '');
  vi.stubEnv('GATEWAY_ENTRY_ORIGIN', '');
  vi.stubEnv('NEXT_PUBLIC_GATEWAY_BACKEND_PATH', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the workbench session answer', () => {
  it('states where the replica talks to: the backend mount on the public origin, and the cookie that carries the account', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://api.proflow.local');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pk');
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_ORIGIN', 'https://proflow.local');

    const body = await (await GET(request())).json();

    // Same origin as the page, so no request needs a preflight; the cookie
    // is the one the platform's own client writes, named after ITS url.
    expect(body.sync).toEqual({
      url: 'https://proflow.local/backend',
      key: 'pk',
      cookie: 'sb-api-auth-token',
    });
  });

  it('mounts the backend where the deployment says', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://api.proflow.local');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pk');
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_ORIGIN', 'https://proflow.local');
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_BACKEND_PATH', '/sync');

    const body = await (await GET(request())).json();

    expect(body.sync.url).toBe('https://proflow.local/sync');
  });

  it('takes the origin the browser reached the edge on when none is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://api.proflow.local');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pk');

    const body = await (
      await GET(
        request({
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'proflow.local',
        })
      )
    ).json();

    expect(body.sync.url).toBe('https://proflow.local/backend');
    expect(body.sync.cookie).toBe('sb-api-auth-token');
  });

  it('withholds it when the server is not configured for replication', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pk');
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_ORIGIN', 'https://proflow.local');
    const body = await (await GET(request())).json();

    expect(body.sync).toBeUndefined();
    expect(body.userId).toBe('u-1');
  });

  it('carries the write scope the database stated for the active space, and none when it stated none', async () => {
    rpc.mockResolvedValueOnce({ data: SCOPE, error: null });
    const body = await (await GET(request())).json();

    expect(rpc).toHaveBeenCalledWith('rpc_my_write_scope', {
      p_space_id: 'spc_one.01m2',
    });
    expect(body.writeScope).toEqual(SCOPE);

    const without = await (await GET(request())).json();
    expect('writeScope' in without).toBe(false);
  });

  it('withholds it when only half the configuration is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://server.test');
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_ORIGIN', 'https://proflow.local');

    const body = await (await GET(request())).json();

    expect(body.sync).toBeUndefined();
  });
});
