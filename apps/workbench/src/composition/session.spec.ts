import { entityIdRegistry } from '@workspace/entity-id';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authCookieFingerprint,
  CONFIRMATION_GOOD_FOR_MS,
  forgetSession,
  readSession,
  recallSession,
  rememberSession,
  SessionUnreachable,
  type WorkbenchSession,
} from './session';

const SESSION: WorkbenchSession = {
  userId: '11111111-2222-3333-4444-555555555555',
  email: 'user@example.test',
  spaceId: entityIdRegistry.factories.spaceIdFactory.brand(
    'spc_0000000000000abc.0000000000'
  ),
  spaceName: 'Space',
};

function setCookies(value: string) {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  setCookies('sb-access-token=one; other=x');
  vi.restoreAllMocks();
});

describe('the last confirmed identity', () => {
  it('is recalled for the account whose cookies are still present', () => {
    rememberSession(SESSION);
    expect(recallSession()).toEqual(SESSION);
  });

  it('is refused once the account cookies differ', () => {
    rememberSession(SESSION);
    setCookies('sb-access-token=two; other=x');
    expect(recallSession()).toBeNull();
  });

  it('ignores non-account cookies changing', () => {
    rememberSession(SESSION);
    setCookies('sb-access-token=one; other=changed');
    expect(recallSession()).toEqual(SESSION);
  });

  it('is gone once forgotten', () => {
    rememberSession(SESSION);
    forgetSession();
    expect(recallSession()).toBeNull();
  });

  it('is refused when nothing was remembered', () => {
    expect(recallSession()).toBeNull();
  });

  it('is refused when the stored value is not a session', () => {
    window.localStorage.setItem(
      'workbench.session',
      JSON.stringify({ cookies: 'sb-access-token=one', session: { userId: 7 } })
    );
    expect(recallSession()).toBeNull();
  });

  it('is refused when the stored space is not a space id', () => {
    for (const spaceId of ['spc_abc.01m2', 'org_0000000000000abc.0000000000']) {
      window.localStorage.setItem(
        'workbench.session',
        JSON.stringify({
          cookies: authCookieFingerprint(),
          confirmedAt: Date.now(),
          session: { ...SESSION, spaceId },
        })
      );
      expect(recallSession()).toBeNull();
    }
  });

  it('is refused when the stored value is not JSON', () => {
    window.localStorage.setItem('workbench.session', 'not json');
    expect(recallSession()).toBeNull();
  });

  /**
   * The account cookies are the serialized session itself — access and
   * refresh tokens included — and the browser lets scripts read them. What
   * is kept here pins the record to an account; it must never be a second
   * copy of what pins it, which would outlive the cookies it was taken
   * from and sit in a store no cookie attribute protects.
   */
  it('keeps no part of the account cookies it was pinned to', () => {
    const token =
      'base64-eyJhY2Nlc3NfdG9rZW4iOiJzZWNyZXQtYWNjZXNzIiwicmVmcmVzaF90b2tlbiI6InNlY3JldC1yZWZyZXNoIn0';
    setCookies(`sb-proj-auth-token=${token}; other=x`);
    rememberSession(SESSION);
    const stored = window.localStorage.getItem('workbench.session') ?? '';
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(token.slice(0, 24));
    // Still usable for what it exists for.
    expect(recallSession()).toEqual(SESSION);
  });

  /**
   * The replication target the server states belongs in the settings store
   * the replica reads, not in the offline record. Keeping it in both would
   * make one fact into two things to keep current, and would let a stale
   * copy in a record built for identity outlive a key rotation.
   */
  it('keeps no replication target, even when the session carried one', () => {
    rememberSession({
      ...SESSION,
      sync: { url: 'https://server.test', key: 'publishable-key' },
    });
    const stored = window.localStorage.getItem('workbench.session') ?? '';
    expect(stored).not.toContain('publishable-key');
    expect(recallSession()).toEqual(SESSION);
  });
});

/**
 * The confirmation the record carries has a life. Signing out on another
 * device cannot reach this one, so without an end the local copy would
 * stay openable on a device the account has already left.
 */
describe('the age of a confirmation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is refused once the server has not confirmed it for too long', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T09:00:00Z'));
    rememberSession(SESSION);
    vi.setSystemTime(Date.now() + CONFIRMATION_GOOD_FOR_MS + 1);
    expect(recallSession()).toBeNull();
  });

  it('is accepted right up to the limit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T09:00:00Z'));
    rememberSession(SESSION);
    vi.setSystemTime(Date.now() + CONFIRMATION_GOOD_FOR_MS);
    expect(recallSession()).toEqual(SESSION);
  });

  it('slides forward on every confirmation, not from the first one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T09:00:00Z'));
    rememberSession(SESSION);
    // Most of the window spent, then the server answers again.
    vi.setSystemTime(Date.now() + CONFIRMATION_GOOD_FOR_MS - 1000);
    rememberSession(SESSION);
    // Past the ORIGINAL deadline, well inside the refreshed one.
    vi.setSystemTime(Date.now() + 2000);
    expect(recallSession()).toEqual(SESSION);
  });

  it('is refused when the record does not say when it was confirmed', () => {
    window.localStorage.setItem(
      'workbench.session',
      JSON.stringify({ cookies: 'whatever', session: SESSION })
    );
    expect(recallSession()).toBeNull();
  });
});

describe('reading the session', () => {
  it('reports an unreachable server apart from any other failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    await expect(readSession()).rejects.toBeInstanceOf(SessionUnreachable);
  });

  it('reports a signed-out visitor as no session, not a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    );
    await expect(readSession()).resolves.toBeNull();
  });

  const answer = (body: Record<string, unknown>) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
  const identity = {
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'someone@example.test',
    spaceId: 'spc_0000000000000001.0000000000',
    spaceName: 'Space',
  };
  const scope = {
    'node.create': 'all',
    'node.update': { own: ['owner_user_id'] },
    'node.move': { own: ['parent_edge_created_by'] },
    'node.trash': { own: ['owner_user_id'] },
    'node.purge': { own: ['owner_user_id'] },
    'node.star': 'all',
    'body.write': { own: ['owner_user_id'] },
  };

  it('refuses a space that is not a well-formed space id', async () => {
    for (const spaceId of [
      'spc_abc.01m2',
      "spc_' OR 1=1--",
      'org_0000000000000001.0000000000',
    ]) {
      answer({ ...identity, spaceId });
      await expect(readSession()).rejects.toThrow('Invalid session response');
    }
  });

  it('reads the space as a canonical space id, and no space as none', async () => {
    answer({ ...identity, spaceId: 'spc_000000000000000A.0000000000' });
    expect((await readSession())?.spaceId).toBe(
      'spc_000000000000000a.0000000000'
    );
    answer({ ...identity, spaceId: null });
    expect((await readSession())?.spaceId).toBeNull();
  });

  it('carries the write scope the server stated', async () => {
    answer({ ...identity, writeScope: scope });
    expect((await readSession())?.writeScope).toEqual(scope);
  });

  it('drops a write scope it cannot read, without failing the session', async () => {
    answer({ ...identity, writeScope: 'nope' });
    const session = await readSession();
    expect(session?.userId).toBe(identity.userId);
    expect(session && 'writeScope' in session).toBe(false);
  });

  it('reads a session that states no write scope', async () => {
    answer(identity);
    const session = await readSession();
    expect(session?.userId).toBe(identity.userId);
    expect(session?.writeScope).toBeUndefined();
  });

  it('does not call a bad answer unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    );
    await expect(readSession()).rejects.not.toBeInstanceOf(SessionUnreachable);
  });
});
