import { entityIdRegistry } from '@workspace/entity-id';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The subject is the DECISION to start replication, not replication itself:
 * whether the engine is built at all, how many times, and from what. The
 * engine and the transport are mocked wholesale — they are covered by their
 * own package's integration suite against a real PGlite on both sides, and
 * re-proving them here would only prove the mocks.
 */

/**
 * The mocks carry their real parameter shapes: what the spec asserts is WHAT
 * the composition passed (the space it watches, the identity it builds the
 * engine from), so the recorded arguments have to stay typed rather than
 * collapse to an empty tuple.
 */
const {
  watch,
  createGraphSync,
  createSupabaseGraphRowTransport,
  createBrowserClient,
} = vi.hoisted(() => {
  const watch = vi.fn(
    (_spaceId: string, _options?: { onError?: (error: unknown) => void }) => ({
      stop: vi.fn(),
      kick: vi.fn(),
    })
  );
  return {
    watch,
    createGraphSync: vi.fn((_options: { identity: { userId: string } }) => ({
      watch,
      pull: vi.fn(),
      push: vi.fn(),
      pendingCount: vi.fn(),
    })),
    createSupabaseGraphRowTransport: vi.fn((_client: unknown) => ({
      subscribe: vi.fn(() => vi.fn()),
    })),
    createBrowserClient: vi.fn(
      (_url: string, _key: string, _options?: unknown) => ({})
    ),
  };
});

vi.mock('@workspace/graph-sync', () => ({
  createGraphSync,
  createSupabaseGraphRowTransport,
}));
vi.mock('@supabase/ssr', () => ({ createBrowserClient }));
vi.mock('@workspace/persistence-pglite', () => ({
  createPgliteGraphReplicaWriter: vi.fn(() => ({})),
  createPgliteGraphSyncLedger: vi.fn(() => ({})),
}));

import { ok } from 'neverthrow';
import type { ISettingsStore } from '@workspace/domain';
import type { AppDb } from '@workspace/persistence-pglite';
import {
  parseSyncSettings,
  rememberSyncSettings,
  startGraphSync,
  SYNC_SETTINGS_KEY,
} from './sync';

const IDENTITY = {
  userId: 'user-1',
  spaceId: entityIdRegistry.factories.spaceIdFactory.brand('spc_abc.01m2'),
};

function settingsHolding(value: string | null): ISettingsStore {
  return {
    get: vi.fn(async () => ok(value)),
    set: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

/** Lets the settings read (a promise chain) land before asserting. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const CONFIGURED = JSON.stringify({
  url: 'https://server.test',
  key: 'publishable-key',
  cookie: 'sb-api-auth-token',
});

/** A store that keeps what is written to it, as the real one does. */
function settingsStore(initial: Record<string, string>): ISettingsStore {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => ok(values.get(key) ?? null)),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return ok(undefined);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
      return ok(undefined);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(true);
});

describe('starting graph replication', () => {
  it('hands a pull outcome to the composition', async () => {
    const onPulled = vi.fn();
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
      onPulled,
    });
    await settled();
    const hooks = watch.mock.calls[0]?.[1] as
      | {
          onPull?: (outcome: {
            applied: number;
            evicted: number;
            swept: string[];
            refused: unknown[];
          }) => void;
        }
      | undefined;
    expect(hooks?.onPull).toBeTypeOf('function');
    hooks?.onPull?.({ applied: 2, evicted: 0, swept: [], refused: [] });
    expect(onPulled).toHaveBeenCalledWith(
      expect.objectContaining({ applied: 2 })
    );
    stop();
  });

  it('hands rows the server sent that could not be taken in to the composition, and only those', async () => {
    const onRefused = vi.fn();
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
      onRefused,
    });
    await settled();
    const hooks = watch.mock.calls[0]?.[1] as {
      onPull: (outcome: unknown) => void;
    };
    hooks.onPull({ applied: 1, evicted: 0, swept: [], refused: [] });
    expect(onRefused).not.toHaveBeenCalled();
    const row = {
      table: 'knowledge_resources',
      id: 'knr_not-an-id',
      updatedAt: null,
      error: new Error('server row refused'),
    };
    hooks.onPull({ applied: 0, evicted: 0, swept: [], refused: [row] });
    expect(onRefused).toHaveBeenCalledWith([row]);
    stop();
  });

  it('does not build an engine when no configuration was ever received', async () => {
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(null),
      identity: IDENTITY,
    });
    await settled();
    expect(createGraphSync).not.toHaveBeenCalled();
    stop();
  });

  it('does not build an engine while the device is offline', async () => {
    setOnline(false);
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
    });
    await settled();
    expect(createGraphSync).not.toHaveBeenCalled();
    stop();
  });

  it('builds one engine and watches the checked-out space when configured and online', async () => {
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
    });
    await settled();
    expect(createGraphSync).toHaveBeenCalledTimes(1);
    // The account's cookie is named after the platform's API host, not
    // after the url this client is built with.
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://server.test',
      'publishable-key',
      { cookieOptions: { name: 'sb-api-auth-token' } }
    );
    expect(createGraphSync.mock.calls[0]?.[0]).toMatchObject({
      identity: { userId: 'user-1' },
    });
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch.mock.calls[0]?.[0]).toBe('spc_abc.01m2');
    stop();
  });

  it('tells a stalled push from a completed one, and never takes a pull for recovery', async () => {
    const onSettled = vi.fn();
    const onStalled = vi.fn();
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
      onSettled,
      onStalled,
    });
    await settled();
    const hooks = watch.mock.calls[0]?.[1] as
      | {
          onPush?: (outcome: { stalled: boolean }) => void;
          onPull?: (outcome: unknown) => void;
        }
      | undefined;
    expect(hooks?.onPush).toBeTypeOf('function');

    // Reads succeed while writes cannot reach the server: that is not
    // recovery, and a pull after a stalled push must not say so.
    hooks?.onPush?.({ stalled: true });
    hooks?.onPull?.({ applied: 3, evicted: 0, swept: [], refused: [] });
    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();

    hooks?.onPush?.({ stalled: false });
    expect(onSettled).toHaveBeenCalledTimes(1);
    stop();
  });

  it('says so when a push got changes accepted, and only then', async () => {
    const onPushed = vi.fn();
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
      onPushed,
    });
    await settled();
    const hooks = watch.mock.calls[0]?.[1] as
      | { onPush?: (outcome: { stalled: boolean; accepted: number }) => void }
      | undefined;

    hooks?.onPush?.({ stalled: false, accepted: 0 });
    hooks?.onPush?.({ stalled: true, accepted: 0 });
    expect(onPushed).not.toHaveBeenCalled();

    hooks?.onPush?.({ stalled: false, accepted: 2 });
    expect(onPushed).toHaveBeenCalledWith({ stalled: false, accepted: 2 });
    stop();
  });

  it('starts once when the network returns, not once per event', async () => {
    setOnline(false);
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
    });
    await settled();
    expect(createGraphSync).not.toHaveBeenCalled();

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await settled();

    expect(createGraphSync).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops watching when disposed and never starts afterwards', async () => {
    const dispose = vi.fn();
    watch.mockReturnValueOnce({ stop: dispose, kick: vi.fn() });
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
    });
    await settled();
    stop();
    expect(dispose).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    await settled();
    expect(createGraphSync).toHaveBeenCalledTimes(1);
  });

  it('ignores a stored configuration that is not usable', async () => {
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding('{"url":"https://server.test"}'),
      identity: IDENTITY,
    });
    await settled();
    expect(createGraphSync).not.toHaveBeenCalled();
    stop();
  });

  it('starts only once a setting with a cookie is stored', async () => {
    // A device upgraded with the setting an older build stored: a url and a
    // key, no cookie name. Built from it, the client would look for a
    // cookie that does not exist; it waits for the next session check.
    const settings = settingsStore({
      [SYNC_SETTINGS_KEY]: JSON.stringify({
        url: 'https://api.server.test',
        key: 'publishable-key',
      }),
    });
    const stop = startGraphSync({
      db: {} as AppDb,
      settings,
      identity: IDENTITY,
    });
    await settled();
    expect(createBrowserClient).not.toHaveBeenCalled();
    expect(createGraphSync).not.toHaveBeenCalled();

    await rememberSyncSettings(settings, {
      url: 'https://proflow.local/backend',
      key: 'publishable-key',
      cookie: 'sb-api-auth-token',
    });
    window.dispatchEvent(new Event('online'));
    await settled();

    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://proflow.local/backend',
      'publishable-key',
      { cookieOptions: { name: 'sb-api-auth-token' } }
    );
    stop();
  });

  it('retries on the next network event after a failed attempt', async () => {
    // A start that throws must not be the last one this page makes: the
    // journal keeps filling, so a permanently wedged starter is a queue
    // that silently never drains again.
    const onError = vi.fn();
    createBrowserClient.mockImplementationOnce(() => {
      throw new Error('unusable configuration');
    });
    const stop = startGraphSync({
      db: {} as AppDb,
      settings: settingsHolding(CONFIGURED),
      identity: IDENTITY,
      onError,
    });
    await settled();
    expect(createGraphSync).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    await settled();
    expect(createGraphSync).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('remembering the configuration the server sent', () => {
  it('stores it under one key, as sent', async () => {
    const settings = settingsHolding(null);
    await rememberSyncSettings(settings, {
      url: 'https://server.test',
      key: 'publishable-key',
      cookie: 'sb-api-auth-token',
    });
    expect(settings.set).toHaveBeenCalledWith(SYNC_SETTINGS_KEY, CONFIGURED);
  });
});

describe('reading the stored configuration', () => {
  it('takes a url, a key and the cookie name', () => {
    expect(
      parseSyncSettings(
        '{"url":"https://proflow.local/backend","key":"pk","cookie":"sb-api-auth-token"}'
      )
    ).toEqual({
      url: 'https://proflow.local/backend',
      key: 'pk',
      cookie: 'sb-api-auth-token',
    });
  });

  it('refuses one without the cookie name: there is no fallback to a derived one', () => {
    expect(
      parseSyncSettings('{"url":"https://proflow.local/backend","key":"pk"}')
    ).toBeNull();
    expect(
      parseSyncSettings(
        '{"url":"https://proflow.local/backend","key":"pk","cookie":""}'
      )
    ).toBeNull();
  });
});
