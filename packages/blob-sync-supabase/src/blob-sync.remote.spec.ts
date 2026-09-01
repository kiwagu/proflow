import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import { describe, expect, it, vi } from 'vitest';
import {
  blobObjectKey,
  createSupabaseBlobSyncRemote,
} from './blob-sync.remote.js';

const SPACE = 'spc_test';
const HASH = 'a'.repeat(64);

type Recorder = {
  inserted: unknown[];
  uploaded: Array<{ path: string; upsert: boolean }>;
};

/**
 * A stand-in for the PostgREST + Storage surface this adapter drives. It is a
 * fake, not a mock of a real database: what these tests assert is the adapter's
 * ORDERING and its treatment of duplicates, which are policy decisions of this
 * file — the SQL fence itself is asserted by the migration and by RLS.
 */
function fakeClient(opts?: {
  certified?: boolean;
  uploadError?: { message: string };
  insertError?: { code?: string; message: string };
  selectError?: { message: string };
  signedUrl?: string | null;
  userId?: string | null;
}): { db: SupabaseClient<Database>; rec: Recorder } {
  const rec: Recorder = { inserted: [], uploaded: [] };
  const db = {
    auth: {
      getUser: async () => ({
        data: {
          user: opts?.userId === null ? null : { id: opts?.userId ?? 'u1' },
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts?.certified ? { hash: HASH } : null,
              error: opts?.selectError ?? null,
            }),
          }),
        }),
      }),
      insert: async (row: unknown) => {
        rec.inserted.push(row);
        return { error: opts?.insertError ?? null };
      },
    }),
    storage: {
      from: () => ({
        upload: async (path: string, _blob: Blob, o: { upsert: boolean }) => {
          rec.uploaded.push({ path, upsert: o.upsert });
          return { error: opts?.uploadError ?? null };
        },
        createSignedUrl: async () =>
          opts?.signedUrl
            ? { data: { signedUrl: opts.signedUrl }, error: null }
            : { data: null, error: { message: 'Object not found' } },
      }),
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, rec };
}

describe('object key', () => {
  it('is the space prefix plus the content hash, and nothing else', () => {
    // Node-addressed keys were rejected on purpose: one blob may back many
    // nodes, and a rename must never be a storage event.
    expect(blobObjectKey(SPACE, HASH)).toBe(`spaces/${SPACE}/blobs/${HASH}`);
  });
});

describe('supabase blob sync remote', () => {
  it('reports a certificate when the row exists', async () => {
    const { db } = fakeClient({ certified: true });
    await expect(
      createSupabaseBlobSyncRemote(db, SPACE).isCertified(HASH)
    ).resolves.toBe(true);
  });

  it('surfaces a read failure instead of reporting "not certified"', async () => {
    // Silently answering false would make the loop re-upload on every pass.
    const { db } = fakeClient({ selectError: { message: 'boom' } });
    await expect(
      createSupabaseBlobSyncRemote(db, SPACE).isCertified(HASH)
    ).rejects.toThrow(/certificate read/);
  });

  it('uploads without upsert, under the content-addressed key', async () => {
    const { db, rec } = fakeClient();
    await createSupabaseBlobSyncRemote(db, SPACE).putObject(
      HASH,
      new Blob(['x'])
    );
    expect(rec.uploaded).toEqual([
      { path: `spaces/${SPACE}/blobs/${HASH}`, upsert: false },
    ]);
  });

  it('treats an already-present object as success', async () => {
    // The key is the content: whatever is there is byte-identical.
    const { db } = fakeClient({
      uploadError: { message: 'The resource already exists' },
    });
    await expect(
      createSupabaseBlobSyncRemote(db, SPACE).putObject(HASH, new Blob(['x']))
    ).resolves.toBeUndefined();
  });

  it('still raises a genuine upload failure', async () => {
    const { db } = fakeClient({
      uploadError: { message: 'payload too large' },
    });
    await expect(
      createSupabaseBlobSyncRemote(db, SPACE).putObject(HASH, new Blob(['x']))
    ).rejects.toThrow(/upload/);
  });

  it('writes the certificate with the caller as author', async () => {
    const { db, rec } = fakeClient({ userId: 'u42' });
    await createSupabaseBlobSyncRemote(db, SPACE).certify({
      hash: HASH,
      size: 7,
      mime: 'text/plain',
    });
    expect(rec.inserted).toEqual([
      {
        space_id: SPACE,
        hash: HASH,
        size: 7,
        mime: 'text/plain',
        created_by: 'u42',
      },
    ]);
  });

  it('treats a losing race to certify as success', async () => {
    // The winner wrote the same row: same space, same content hash.
    const { db } = fakeClient({
      insertError: { code: '23505', message: 'duplicate key value' },
    });
    await expect(
      createSupabaseBlobSyncRemote(db, SPACE).certify({
        hash: HASH,
        size: 7,
        mime: 'text/plain',
      })
    ).resolves.toBeUndefined();
  });

  it('refuses to certify without a session rather than writing a wrong author', async () => {
    const { db } = fakeClient({ userId: null });
    await expect(
      createSupabaseBlobSyncRemote(db, SPACE).certify({
        hash: HASH,
        size: 7,
        mime: 'text/plain',
      })
    ).rejects.toThrow(/authenticated session/);
  });

  it('fetches bytes through a signed url', async () => {
    const { db } = fakeClient({ signedUrl: 'https://example.invalid/signed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bytes', { status: 200 }))
    );
    const got = await createSupabaseBlobSyncRemote(db, SPACE).fetchObject(HASH);
    expect(await got!.text()).toBe('bytes');
    vi.unstubAllGlobals();
  });

  it('resolves to null when no url can be issued', async () => {
    // Missing and forbidden look identical on purpose: no existence oracle.
    const { db } = fakeClient({ signedUrl: null });
    await expect(
      createSupabaseBlobSyncRemote(db, SPACE).fetchObject(HASH)
    ).resolves.toBeNull();
  });
});
