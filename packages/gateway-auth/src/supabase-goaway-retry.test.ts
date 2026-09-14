import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchRetryingGoaway } from './supabase-goaway-retry.js';

function goawayError(): Error {
  const cause = Object.assign(
    new Error('HTTP/2: "GOAWAY" frame received with code 0'),
    { code: 'UND_ERR_INFO', name: 'InformationalError' }
  );
  return Object.assign(new TypeError('fetch failed'), { cause });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRetryingGoaway', () => {
  it('replays a request the peer refused with a graceful GOAWAY', async () => {
    const ok = new Response('ok');
    const impl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(goawayError())
      .mockResolvedValueOnce(ok);
    vi.stubGlobal('fetch', impl);

    await expect(fetchRetryingGoaway('https://edge.test/rest')).resolves.toBe(
      ok
    );
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('retries at most once, so a persistent GOAWAY still surfaces', async () => {
    const impl = vi.fn<typeof fetch>().mockRejectedValue(goawayError());
    vi.stubGlobal('fetch', impl);

    await expect(fetchRetryingGoaway('https://edge.test/rest')).rejects.toThrow(
      'fetch failed'
    );
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a genuine transport failure', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    });
    const impl = vi.fn<typeof fetch>().mockRejectedValue(refused);
    vi.stubGlobal('fetch', impl);

    await expect(fetchRetryingGoaway('https://edge.test/rest')).rejects.toThrow(
      'fetch failed'
    );
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('does not retry an UND_ERR_INFO that is not a GOAWAY', async () => {
    const other = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Request information'), {
        code: 'UND_ERR_INFO',
      }),
    });
    const impl = vi.fn<typeof fetch>().mockRejectedValue(other);
    vi.stubGlobal('fetch', impl);

    await expect(fetchRetryingGoaway('https://edge.test/rest')).rejects.toThrow(
      'fetch failed'
    );
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('passes the request through untouched when nothing fails', async () => {
    const ok = new Response('ok');
    const impl = vi.fn<typeof fetch>().mockResolvedValue(ok);
    vi.stubGlobal('fetch', impl);
    const init: RequestInit = { method: 'POST', body: '{}' };

    await expect(
      fetchRetryingGoaway('https://edge.test/rest', init)
    ).resolves.toBe(ok);
    expect(impl).toHaveBeenCalledExactlyOnceWith(
      'https://edge.test/rest',
      init
    );
  });
});
