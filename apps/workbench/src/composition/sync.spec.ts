import { entityIdRegistry } from '@workspace/entity-id';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The graph half of replication as the leader tab composes it: what the
 * engine is built from, what its outcomes are handed to, and how the nudge
 * channel maps onto kicks. The engine and the transport are mocked
 * wholesale — they are covered by their own package's suite against a real
 * PGlite on both sides. When replication starts at all (settings, network,
 * leadership) is the subject of sync-composition.spec.
 */

const {
  watch,
  kick,
  stopWatch,
  createGraphSync,
  createSupabaseGraphRowTransport,
  subscribe,
} = vi.hoisted(() => {
  const kick = vi.fn();
  const stopWatch = vi.fn();
  const watch = vi.fn(
    (_spaceId: string, _options?: { onError?: (error: unknown) => void }) => ({
      stop: stopWatch,
      kick,
    })
  );
  const subscribe = vi.fn(
    (
      _spaceId: string,
      _handlers: {
        onChange: () => void;
        onDelete: () => void;
        onStatus?: (up: boolean) => void;
      }
    ) => vi.fn()
  );
  return {
    watch,
    kick,
    stopWatch,
    subscribe,
    createGraphSync: vi.fn((_options: { identity: { userId: string } }) => ({
      watch,
      pull: vi.fn(),
      push: vi.fn(),
      pendingCount: vi.fn(),
    })),
    createSupabaseGraphRowTransport: vi.fn((_client: unknown) => ({
      subscribe,
    })),
  };
});

vi.mock('@workspace/graph-sync', () => ({
  createGraphSync,
  createSupabaseGraphRowTransport,
}));
vi.mock('@workspace/persistence-pglite', () => ({
  createPgliteGraphReplicaWriter: vi.fn(() => ({})),
  createPgliteGraphSyncLedger: vi.fn(() => ({})),
}));

import { ok } from 'neverthrow';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
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
const CLIENT = {
  name: 'the leader client',
} as unknown as SupabaseClient<Database>;

const CONFIGURED = JSON.stringify({
  url: 'https://server.test',
  key: 'publishable-key',
  cookie: 'sb-api-auth-token',
});

function settingsHolding(value: string | null): ISettingsStore {
  return {
    get: vi.fn(async () => ok(value)),
    set: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
}

type PullOutcome = {
  applied: number;
  evicted: number;
  swept: string[];
  refused: unknown[];
};
type Hooks = {
  onPull: (outcome: PullOutcome) => void;
  onPush: (outcome: { stalled: boolean; accepted: number }) => void;
};

const hooksOf = () => watch.mock.calls[0]?.[1] as unknown as Hooks;
const start = (options: Partial<Parameters<typeof startGraphSync>[0]> = {}) =>
  startGraphSync({
    db: {} as AppDb,
    client: CLIENT,
    identity: IDENTITY,
    ...options,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('graph replication on the leader client', () => {
  it('builds one engine over the client it is given and watches the checked-out space', () => {
    const handle = start();
    expect(createSupabaseGraphRowTransport).toHaveBeenCalledWith(CLIENT);
    expect(createGraphSync).toHaveBeenCalledTimes(1);
    expect(createGraphSync.mock.calls[0]?.[0]).toMatchObject({
      identity: { userId: 'user-1' },
    });
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch.mock.calls[0]?.[0]).toBe('spc_abc.01m2');
    handle.stop();
  });

  it('hands a pull outcome to the composition', () => {
    const onPulled = vi.fn();
    const handle = start({ onPulled });
    hooksOf().onPull({ applied: 2, evicted: 0, swept: [], refused: [] });
    expect(onPulled).toHaveBeenCalledWith(
      expect.objectContaining({ applied: 2 })
    );
    handle.stop();
  });

  it('hands rows the server sent that could not be taken in to the composition, and only those', () => {
    const onRefused = vi.fn();
    const handle = start({ onRefused });
    hooksOf().onPull({ applied: 1, evicted: 0, swept: [], refused: [] });
    expect(onRefused).not.toHaveBeenCalled();
    const row = {
      table: 'knowledge_resources',
      id: 'knr_not-an-id',
      updatedAt: null,
      error: new Error('server row refused'),
    };
    hooksOf().onPull({ applied: 0, evicted: 0, swept: [], refused: [row] });
    expect(onRefused).toHaveBeenCalledWith([row]);
    handle.stop();
  });

  it('tells a stalled push from a completed one, and never takes a pull for recovery', () => {
    const onSettled = vi.fn();
    const onStalled = vi.fn();
    const handle = start({ onSettled, onStalled });
    // Reads succeed while writes cannot reach the server: that is not
    // recovery, and a pull after a stalled push must not say so.
    hooksOf().onPush({ stalled: true, accepted: 0 });
    hooksOf().onPull({ applied: 3, evicted: 0, swept: [], refused: [] });
    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
    hooksOf().onPush({ stalled: false, accepted: 0 });
    expect(onSettled).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('says so when a push got changes accepted, and only then', () => {
    const onPushed = vi.fn();
    const handle = start({ onPushed });
    hooksOf().onPush({ stalled: false, accepted: 0 });
    hooksOf().onPush({ stalled: true, accepted: 0 });
    expect(onPushed).not.toHaveBeenCalled();
    hooksOf().onPush({ stalled: false, accepted: 2 });
    expect(onPushed).toHaveBeenCalledWith({ stalled: false, accepted: 2 });
    handle.stop();
  });

  it('a nudge kicks the engine; a deletion nudge kicks it with a sweep', () => {
    const handle = start();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]?.[0]).toBe('spc_abc.01m2');
    const handlers = subscribe.mock.calls[0]![1];
    handlers.onChange();
    expect(kick).toHaveBeenLastCalledWith();
    handlers.onDelete();
    expect(kick).toHaveBeenLastCalledWith({ sweep: true });
    handle.stop();
  });

  it('says whether its nudge channel is up', () => {
    const onChannel = vi.fn();
    const handle = start({ onChannel });
    const handlers = subscribe.mock.calls[0]![1];
    handlers.onStatus?.(true);
    handlers.onStatus?.(false);
    expect(onChannel.mock.calls).toEqual([[true], [false]]);
    handle.stop();
  });

  it('hands kicks to the engine as they come', () => {
    const handle = start();
    handle.kick();
    handle.kick({ sweep: true });
    expect(kick.mock.calls).toEqual([[undefined], [{ sweep: true }]]);
    handle.stop();
  });

  it('stops the engine and closes the channel when stopped', () => {
    const handle = start();
    const unsubscribe = subscribe.mock.results[0]?.value as ReturnType<
      typeof vi.fn
    >;
    handle.stop();
    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
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
    expect(parseSyncSettings('{"url":"https://server.test"}')).toBeNull();
    expect(parseSyncSettings('not json')).toBeNull();
  });
});
