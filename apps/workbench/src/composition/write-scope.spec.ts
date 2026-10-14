import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { ISettingsStore } from '@workspace/domain';
import type { WriteScope } from '@workspace/knowledge-contracts';
import {
  createWriteScopeStore,
  WRITE_SCOPE_SETTINGS_PREFIX,
} from './write-scope';

/**
 * The write scope the session states, kept for the page: it changes when a
 * session check says so, survives a reload and an offline start, and starts
 * as "no hint" when nothing was ever stated.
 */

function memorySettings(seed: Record<string, string> = {}): ISettingsStore & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(seed));
  return {
    values,
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

const SPACE = 'spc_0000000000000001.0000000000';
const KEY = `${WRITE_SCOPE_SETTINGS_PREFIX}${SPACE}`;
const MEMBER: WriteScope = {
  'node.create': 'all',
  'node.update': { own: ['owner_user_id'] },
  'node.move': { own: ['parent_edge_created_by'] },
  'node.trash': { own: ['owner_user_id'] },
  'node.purge': { own: ['owner_user_id'] },
  'node.star': 'all',
  'body.write': { own: ['owner_user_id'] },
};
const AUTHOR: WriteScope = {
  ...MEMBER,
  'node.update': 'all',
  'body.write': 'all',
};

describe('the write scope store', () => {
  it('has no hint when nothing was ever stated, so everything stays editable', async () => {
    const store = await createWriteScopeStore({
      settings: memorySettings(),
      spaceId: SPACE,
    });
    expect(store.current()).toBeNull();
  });

  it('keeps what the server stated, tells its listeners once, and persists it', async () => {
    const settings = memorySettings();
    const store = await createWriteScopeStore({ settings, spaceId: SPACE });
    const listener = vi.fn();
    store.subscribe(listener);

    store.accept(MEMBER);

    expect(store.current()).toEqual(MEMBER);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(JSON.parse(settings.values.get(KEY) ?? 'null')).toEqual(MEMBER)
    );
  });

  it('starts from the scope a previous page kept, for an offline start', async () => {
    const settings = memorySettings({ [KEY]: JSON.stringify(MEMBER) });
    const store = await createWriteScopeStore({ settings, spaceId: SPACE });
    expect(store.current()).toEqual(MEMBER);
  });

  it('keeps its scope when a session states none', async () => {
    const store = await createWriteScopeStore({
      settings: memorySettings(),
      spaceId: SPACE,
    });
    store.accept(MEMBER);
    store.accept(undefined);
    expect(store.current()).toEqual(MEMBER);
  });

  it('does not tell its listeners about a scope equal to the one it holds', async () => {
    const store = await createWriteScopeStore({
      settings: memorySettings(),
      spaceId: SPACE,
    });
    store.accept(MEMBER);
    const listener = vi.fn();
    store.subscribe(listener);

    store.accept(JSON.parse(JSON.stringify(MEMBER)) as WriteScope);
    expect(listener).not.toHaveBeenCalled();

    store.accept(AUTHOR);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.current()).toEqual(AUTHOR);
  });

  it('ignores a kept value it cannot read', async () => {
    const store = await createWriteScopeStore({
      settings: memorySettings({ [KEY]: '{not json' }),
      spaceId: SPACE,
    });
    expect(store.current()).toBeNull();
    const other = await createWriteScopeStore({
      settings: memorySettings({
        [KEY]: JSON.stringify({ 'node.create': 'all' }),
      }),
      spaceId: SPACE,
    });
    expect(other.current()).toBeNull();
  });

  it('stops telling a listener once it unsubscribed', async () => {
    const store = await createWriteScopeStore({
      settings: memorySettings(),
      spaceId: SPACE,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.accept(MEMBER);
    expect(listener).not.toHaveBeenCalled();
  });
});
