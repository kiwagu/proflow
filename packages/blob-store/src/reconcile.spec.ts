import type { BlobInfo, IBlobStore, IBlobSyncLocal } from '@workspace/domain';
import { describe, expect, it } from 'vitest';
import { createBlobStoreOver } from './store.js';
import type { BlobBackend } from './backend.js';
import { hashBlob } from './hash.js';
import { ensureLocal, pushBlob, runPushPass } from './reconcile.js';

/** In-memory backend, enough for the store's contract (write/read/size/remove). */
function memoryBackend(): BlobBackend {
  const files = new Map<string, Blob>();
  return {
    name: 'opfs',
    async write(hash, blob) {
      files.set(hash, blob);
    },
    async read(hash) {
      return files.get(hash) ?? null;
    },
    async size(hash) {
      return files.get(hash)?.size ?? null;
    },
    async remove(hash) {
      files.delete(hash);
    },
    // The package area is irrelevant to sync; blobs are the only unit that
    // travels, and an unpacked archive is rebuildable from its blob.
    writeEntry: async () => 0,
    readEntry: async () => null,
    removePackage: async () => {},
    listPackages: async () => [],
    async list() {
      return [...files].map(([hash, blob]) => ({ hash, size: blob.size }));
    },
    async clear() {
      files.clear();
    },
  };
}

function memoryLocal(seed: BlobInfo[] = []): IBlobSyncLocal & {
  states: Map<string, 'local' | 'synced'>;
  infos: Map<string, BlobInfo>;
} {
  const states = new Map<string, 'local' | 'synced'>();
  const infos = new Map<string, BlobInfo>();
  for (const info of seed) {
    states.set(info.hash, 'local');
    infos.set(info.hash, info);
  }
  return {
    states,
    infos,
    async pending(limit) {
      return [...infos.values()]
        .filter((info) => states.get(info.hash) === 'local')
        .slice(0, limit)
        .map((info) => ({ ...info, syncState: 'local' as const }));
    },
    async markSynced(hash) {
      states.set(hash, 'synced');
    },
    async registerSynced(info) {
      infos.set(info.hash, info);
      states.set(info.hash, 'synced');
    },
    async find(hash) {
      const info = infos.get(hash);
      if (!info) return null;
      return { ...info, syncState: states.get(hash) ?? 'local' };
    },
  };
}

type RemoteCalls = { puts: string[]; certs: string[] };

function memoryRemote(
  calls: RemoteCalls,
  opts?: { certified?: Set<string>; objects?: Map<string, Blob> }
) {
  const certified = opts?.certified ?? new Set<string>();
  const objects = opts?.objects ?? new Map<string, Blob>();
  return {
    certified,
    objects,
    async isCertified(hash: string) {
      return certified.has(hash);
    },
    async putObject(hash: string, blob: Blob) {
      calls.puts.push(hash);
      objects.set(hash, blob);
    },
    async certify(info: BlobInfo) {
      calls.certs.push(info.hash);
      certified.add(info.hash);
    },
    async fetchObject(hash: string) {
      return certified.has(hash) ? (objects.get(hash) ?? null) : null;
    },
  };
}

async function seededStore(contents: string[]): Promise<{
  store: IBlobStore;
  infos: BlobInfo[];
}> {
  const store = createBlobStoreOver(memoryBackend());
  const infos: BlobInfo[] = [];
  for (const content of contents) {
    infos.push(await store.put(new Blob([content], { type: 'text/plain' })));
  }
  return { store, infos };
}

describe('media reconcile — push', () => {
  it('uploads bytes before writing the certificate', async () => {
    const { store, infos } = await seededStore(['alpha']);
    const calls: RemoteCalls = { puts: [], certs: [] };
    const local = memoryLocal(infos);

    const outcome = await pushBlob(
      { store, local, remote: memoryRemote(calls) },
      infos[0]!
    );

    expect(outcome).toBe('uploaded');
    // The ordering is the durability guarantee: a certificate must never
    // describe bytes that are not fully there.
    expect(calls.puts).toEqual([infos[0]!.hash]);
    expect(calls.certs).toEqual([infos[0]!.hash]);
    expect(local.states.get(infos[0]!.hash)).toBe('synced');
  });

  it('skips the upload when another device already certified the content', async () => {
    const { store, infos } = await seededStore(['beta']);
    const calls: RemoteCalls = { puts: [], certs: [] };
    const local = memoryLocal(infos);
    const remote = memoryRemote(calls, {
      certified: new Set([infos[0]!.hash]),
    });

    const outcome = await pushBlob({ store, local, remote }, infos[0]!);

    expect(outcome).toBe('already-durable');
    expect(calls.puts).toEqual([]);
    // Still advances local state — the durable copy exists either way.
    expect(local.states.get(infos[0]!.hash)).toBe('synced');
  });

  it('leaves a record pending when the local bytes are gone', async () => {
    const { store, infos } = await seededStore(['gamma']);
    await store.delete(infos[0]!.hash);
    const calls: RemoteCalls = { puts: [], certs: [] };
    const local = memoryLocal(infos);

    const outcome = await pushBlob(
      { store, local, remote: memoryRemote(calls) },
      infos[0]!
    );

    expect(outcome).toBe('missing-locally');
    expect(calls.puts).toEqual([]);
    expect(local.states.get(infos[0]!.hash)).toBe('local');
  });

  it('re-running after a crash between upload and certificate is a no-op upload', async () => {
    const { store, infos } = await seededStore(['delta']);
    const info = infos[0]!;
    const calls: RemoteCalls = { puts: [], certs: [] };
    const local = memoryLocal(infos);
    const remote = memoryRemote(calls);

    // Simulate the crash window: bytes landed, no certificate, local still
    // 'local' — exactly the state a killed tab leaves behind.
    await remote.putObject(info.hash, (await store.get(info.hash))!);
    calls.puts.length = 0;

    const outcome = await pushBlob({ store, local, remote }, info);

    expect(outcome).toBe('uploaded');
    // Content addressing makes the repeat harmless: same key, same bytes.
    expect(calls.puts).toEqual([info.hash]);
    expect(local.states.get(info.hash)).toBe('synced');
  });

  it('a failing blob does not block the rest of the pass', async () => {
    const { store, infos } = await seededStore(['one', 'two', 'three']);
    const local = memoryLocal(infos);
    const calls: RemoteCalls = { puts: [], certs: [] };
    const base = memoryRemote(calls);
    const remote = {
      ...base,
      async putObject(hash: string, blob: Blob) {
        if (hash === infos[1]!.hash) throw new Error('network down');
        return base.putObject(hash, blob);
      },
    };

    const result = await runPushPass({ store, local, remote });

    expect(result).toEqual({
      uploaded: 2,
      alreadyDurable: 0,
      missingLocally: 0,
      failed: 1,
    });
    expect(local.states.get(infos[1]!.hash)).toBe('local');
  });

  it('a second pass drains what the first left pending', async () => {
    const { store, infos } = await seededStore(['x', 'y']);
    const local = memoryLocal(infos);
    const calls: RemoteCalls = { puts: [], certs: [] };
    const remote = memoryRemote(calls);

    const first = await runPushPass({ store, local, remote }, { batch: 1 });
    const second = await runPushPass({ store, local, remote }, { batch: 1 });
    const third = await runPushPass({ store, local, remote }, { batch: 1 });

    expect(first.uploaded).toBe(1);
    expect(second.uploaded).toBe(1);
    // Converged: nothing left to do, and the pass costs one query.
    expect(third).toEqual({
      uploaded: 0,
      alreadyDurable: 0,
      missingLocally: 0,
      failed: 0,
    });
  });
});

describe('media reconcile — pull', () => {
  it('returns held bytes without touching the durable side', async () => {
    const { store, infos } = await seededStore(['held']);
    const calls: RemoteCalls = { puts: [], certs: [] };
    const remote = memoryRemote(calls);
    let fetches = 0;

    const got = await ensureLocal(
      {
        store,
        local: memoryLocal(infos),
        remote: {
          ...remote,
          async fetchObject(hash: string) {
            fetches += 1;
            return remote.fetchObject(hash);
          },
        },
      },
      infos[0]!.hash
    );

    expect(await got!.text()).toBe('held');
    expect(fetches).toBe(0);
  });

  it('fetches, verifies and stores bytes this device does not hold', async () => {
    const source = await seededStore(['pulled']);
    const info = source.infos[0]!;
    const calls: RemoteCalls = { puts: [], certs: [] };
    const remote = memoryRemote(calls, {
      certified: new Set([info.hash]),
      objects: new Map([
        [info.hash, new Blob(['pulled'], { type: 'text/plain' })],
      ]),
    });
    const fresh = createBlobStoreOver(memoryBackend());
    const local = memoryLocal();

    const got = await ensureLocal({ store: fresh, local, remote }, info.hash);

    expect(await got!.text()).toBe('pulled');
    // Landed locally as already-durable: it came from the durable copy.
    expect(local.states.get(info.hash)).toBe('synced');
    expect(await fresh.has(info.hash)).toBe(true);
  });

  it('refuses bytes that do not hash to the requested content', async () => {
    const realHash = await hashBlob(new Blob(['wanted']));
    const calls: RemoteCalls = { puts: [], certs: [] };
    const remote = memoryRemote(calls, {
      certified: new Set([realHash]),
      // The durable side hands back different content under the same key.
      objects: new Map([[realHash, new Blob(['tampered'])]]),
    });
    const fresh = createBlobStoreOver(memoryBackend());

    await expect(
      ensureLocal({ store: fresh, local: memoryLocal(), remote }, realHash)
    ).rejects.toThrow(/failed verification/);
    // Nothing corrupt was written under the hash.
    expect(await fresh.has(realHash)).toBe(false);
  });

  it('resolves to null when nothing is certified for the hash', async () => {
    const calls: RemoteCalls = { puts: [], certs: [] };
    const fresh = createBlobStoreOver(memoryBackend());

    const got = await ensureLocal(
      { store: fresh, local: memoryLocal(), remote: memoryRemote(calls) },
      'f'.repeat(64)
    );

    expect(got).toBeNull();
  });
});
