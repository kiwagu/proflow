import type { ISettingsStore } from '@workspace/domain';
import type { SpaceId } from '@workspace/entity-id';
import {
  parseWriteScope,
  type WriteScope,
} from '@workspace/knowledge-contracts';

/**
 * The write scope of the space this page has checked out: what the server
 * says the person may change, as each session check restates it.
 *
 * It is kept per space in the local settings, so a reload or an offline
 * start begins from the last statement instead of from nothing. With no
 * statement ever kept, it holds no hint and every surface stays editable,
 * as before the scope existed: a missing hint opens nothing the server
 * would not open anyway.
 */
export interface WriteScopeStore {
  current(): WriteScope | null;
  subscribe(listener: () => void): () => void;
  /** A scope a session check just stated: kept, persisted, announced if it changed. */
  accept(scope: WriteScope | undefined): void;
}

export const WRITE_SCOPE_SETTINGS_PREFIX = 'write-scope.';

export async function createWriteScopeStore(input: {
  settings: ISettingsStore;
  spaceId: SpaceId;
}): Promise<WriteScopeStore> {
  const key = `${WRITE_SCOPE_SETTINGS_PREFIX}${input.spaceId}`;
  let scope = await recall(input.settings, key);
  let fingerprint = scope ? fingerprintOf(scope) : null;
  const listeners = new Set<() => void>();

  return {
    current: () => scope,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    accept(next) {
      if (!next) return;
      const nextFingerprint = fingerprintOf(next);
      // Every session check restates the scope; only a change re-renders.
      if (nextFingerprint === fingerprint) return;
      scope = next;
      fingerprint = nextFingerprint;
      void input.settings.set(key, nextFingerprint);
      for (const listener of [...listeners]) listener();
    },
  };
}

async function recall(
  settings: ISettingsStore,
  key: string
): Promise<WriteScope | null> {
  const stored = await settings.get(key);
  if (stored.isErr() || !stored.value) return null;
  try {
    return parseWriteScope(JSON.parse(stored.value));
  } catch {
    return null;
  }
}

/** Key order does not make two statements of one scope different. */
function fingerprintOf(scope: WriteScope): string {
  const sorted = Object.fromEntries(
    Object.entries(scope).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  return JSON.stringify(sorted);
}
