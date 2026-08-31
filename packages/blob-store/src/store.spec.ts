import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlobBackend } from './backend.js';
import { createBlobStoreOver, ensureRoom } from './store.js';

function fakeBackend(overrides: Partial<BlobBackend> = {}): BlobBackend {
  return {
    name: 'opfs',
    write: vi.fn(async () => {}),
    read: async () => null,
    size: async () => null,
    remove: vi.fn(async () => {}),
    writeEntry: async () => 0,
    readEntry: async () => null,
    removePackage: async () => {},
    list: async () => [],
    listPackages: async () => [],
    clear: async () => {},
    ...overrides,
  };
}

const stubEstimate = (quota: number, usage: number) => {
  vi.stubGlobal('navigator', {
    storage: { estimate: async () => ({ quota, usage }) },
  });
};

afterEach(() => vi.unstubAllGlobals());

describe('ensureRoom', () => {
  it('refuses a file that would not fit under the margin, naming the sizes', async () => {
    stubEstimate(1024 ** 3, 0.5 * 1024 ** 3); // 1 GB quota, 0.5 GB used
    await expect(ensureRoom(0.4 * 1024 ** 3)).rejects.toThrow(
      /Not enough storage: the file needs 0\.4 GB but only 0\.5 GB/
    );
  });

  it('lets a fitting file through, and everything when quota is unknown', async () => {
    stubEstimate(10 * 1024 ** 3, 0);
    await expect(ensureRoom(1024 ** 3)).resolves.toBeUndefined();
    vi.stubGlobal('navigator', { storage: {} });
    await expect(ensureRoom(100 * 1024 ** 3)).resolves.toBeUndefined();
  });
});

describe('put failure cleanup', () => {
  it('removes the partial file when the write dies, so `has` cannot lie', async () => {
    stubEstimate(10 * 1024 ** 3, 0);
    const backend = fakeBackend({
      write: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const store = createBlobStoreOver(backend);
    await expect(store.put(new Blob(['payload']))).rejects.toThrow('disk full');
    expect(backend.remove).toHaveBeenCalledTimes(1);
  });
});
