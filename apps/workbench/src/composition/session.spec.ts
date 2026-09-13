import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
  spaceId: 'spc_abc.01m2',
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

  it('is refused when the stored value is not JSON', () => {
    window.localStorage.setItem('workbench.session', 'not json');
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

  it('does not call a bad answer unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    );
    await expect(readSession()).rejects.not.toBeInstanceOf(SessionUnreachable);
  });
});
