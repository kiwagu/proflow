import type { IFileRepository, IPackageStore } from '@workspace/domain';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { AppDb } from '../db/db.js';
import { createPgliteStorageMaintenance } from './storage.maintenance.js';

/**
 * The database answers one question here — which hashes are still wanted —
 * so a fake that answers it is the whole of what these tests need.
 */
function harness(options: {
  stored?: Array<{ hash: string; size: number }>;
  unpacked?: Array<{ hash: string; size: number }>;
  wanted?: string[];
  estimate?: { usage: number; quota: number };
}) {
  const stored = new Map(
    (options.stored ?? []).map((item) => [item.hash, item.size])
  );
  const unpacked = new Map(
    (options.unpacked ?? []).map((item) => [item.hash, item.size])
  );
  const wanted = new Set(options.wanted ?? []);
  const asList = (map: Map<string, number>) =>
    [...map].map(([hash, size]) => ({ hash, size }));

  const db = {
    query: async () => ({ rows: [...wanted].map((hash) => ({ hash })) }),
    close: vi.fn(async () => {}),
  } as unknown as AppDb;

  const blobs = {
    list: async () => asList(stored),
    delete: vi.fn(async (hash: string) => {
      stored.delete(hash);
    }),
    clear: vi.fn(async () => {
      stored.clear();
      unpacked.clear();
    }),
    put: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
  };
  const packages = {
    list: async () => asList(unpacked),
    remove: vi.fn(async (hash: string) => {
      unpacked.delete(hash);
    }),
  } as unknown as IPackageStore & { remove: ReturnType<typeof vi.fn> };
  const files = {
    collectGarbage: vi.fn(async () => ok<string[], string>([])),
  } as unknown as IFileRepository;

  vi.stubGlobal('navigator', {
    storage: options.estimate
      ? { estimate: async () => options.estimate }
      : undefined,
  });

  return {
    maintenance: createPgliteStorageMaintenance(
      db,
      blobs as never,
      packages,
      files,
      // No worker here to answer for the database file.
      { stats: async () => null, compact: async () => null }
    ),
    blobs,
    packages,
    files,
    db,
    storedHashes: () => [...stored.keys()],
    unpackedHashes: () => [...unpacked.keys()],
  };
}

describe('the storage report', () => {
  it('counts wanted bytes as files and the rest as reclaimable', async () => {
    const h = harness({
      stored: [
        { hash: 'kept', size: 100 },
        { hash: 'orphan', size: 40 },
      ],
      unpacked: [{ hash: 'kept', size: 700 }],
      wanted: ['kept'],
      estimate: { usage: 900, quota: 5000 },
    });
    const report = await h.maintenance.report();
    expect(report.isOk() && report.value).toEqual({
      used: 900,
      quota: 5000,
      files: 100,
      unpacked: 700,
      database: 0,
      reclaimable: 40,
    });
  });

  it('counts an unpacked area whose archive is gone as reclaimable too', async () => {
    const h = harness({
      stored: [{ hash: 'kept', size: 10 }],
      unpacked: [
        { hash: 'kept', size: 200 },
        { hash: 'stray', size: 300 },
      ],
      wanted: ['kept'],
    });
    const report = await h.maintenance.report();
    expect(report.isOk() && report.value.reclaimable).toBe(300);
    expect(report.isOk() && report.value.used).toBeNull();
  });
});

describe('freeing what nothing references', () => {
  it('removes the bytes the database has no row for, and keeps the rest', async () => {
    // The state a rebuilt schema leaves: files present, nothing naming them.
    const h = harness({
      stored: [
        { hash: 'kept', size: 100 },
        { hash: 'orphan', size: 40 },
      ],
      unpacked: [{ hash: 'orphan', size: 500 }],
      wanted: ['kept'],
    });
    const freed = await h.maintenance.freeUnused();
    expect(freed.isOk() && freed.value).toBe(540);
    expect(h.storedHashes()).toEqual(['kept']);
    expect(h.unpackedHashes()).toEqual([]);
    expect(h.files.collectGarbage).toHaveBeenCalled();
  });

  it('frees nothing when everything is wanted', async () => {
    const h = harness({
      stored: [{ hash: 'kept', size: 100 }],
      unpacked: [{ hash: 'kept', size: 500 }],
      wanted: ['kept'],
    });
    const freed = await h.maintenance.freeUnused();
    expect(freed.isOk() && freed.value).toBe(0);
    expect(h.blobs.delete).not.toHaveBeenCalled();
    expect(h.packages.remove).not.toHaveBeenCalled();
  });
});

describe('deleting everything', () => {
  it('clears the store before the database', async () => {
    const h = harness({
      stored: [{ hash: 'kept', size: 100 }],
      wanted: ['kept'],
    });
    const order: string[] = [];
    h.blobs.clear.mockImplementation(async () => {
      order.push('store');
    });
    (
      h.db as unknown as { close: ReturnType<typeof vi.fn> }
    ).close.mockImplementation(async () => {
      order.push('database');
    });

    const result = await h.maintenance.deleteEverything();
    expect(result.isOk()).toBe(true);
    // The other way round would leave bytes no database can name — the
    // state this module exists to clean up.
    expect(order).toEqual(['store', 'database']);
  });
});
