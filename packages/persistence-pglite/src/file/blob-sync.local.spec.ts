import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../db/db.js';
import { createPgliteBlobSyncLocal } from './blob-sync.local.js';

/**
 * Runs against a real in-memory PGlite, not a fake: the whole point of this
 * adapter is the SQL, so a hand-written stand-in would only assert that the
 * strings are what they are.
 */
async function freshDb(): Promise<AppDb> {
  const pg = await PGlite.create();
  await pg.exec(`
    create table blob (
      hash text primary key,
      size bigint not null,
      mime text not null,
      sync_state text not null default 'local',
      created_at timestamptz not null default now()
    );
  `);
  return pg as unknown as AppDb;
}

async function insertBlob(
  db: AppDb,
  hash: string,
  opts?: { syncState?: string; createdAt?: string }
) {
  await db.query(
    `insert into blob (hash, size, mime, sync_state, created_at)
     values ($1, 10, 'text/plain', $2, coalesce($3::timestamptz, now()))`,
    [hash, opts?.syncState ?? 'local', opts?.createdAt ?? null]
  );
}

describe('pglite blob sync state', () => {
  let db: AppDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lists only unsynced blobs, oldest first', async () => {
    await insertBlob(db, 'a'.repeat(64), { createdAt: '2026-01-03T00:00:00Z' });
    await insertBlob(db, 'b'.repeat(64), { createdAt: '2026-01-01T00:00:00Z' });
    await insertBlob(db, 'c'.repeat(64), {
      createdAt: '2026-01-02T00:00:00Z',
      syncState: 'synced',
    });

    const pending = await createPgliteBlobSyncLocal(db).pending(10);

    expect(pending.map((p) => p.hash)).toEqual([
      'b'.repeat(64),
      'a'.repeat(64),
    ]);
    expect(pending[0]).toMatchObject({ size: 10, mime: 'text/plain' });
  });

  it('honours the batch limit so one pass stays bounded', async () => {
    for (const c of ['a', 'b', 'c']) {
      await insertBlob(db, c.repeat(64), {
        createdAt: `2026-01-0${['a', 'b', 'c'].indexOf(c) + 1}T00:00:00Z`,
      });
    }

    const pending = await createPgliteBlobSyncLocal(db).pending(2);

    expect(pending).toHaveLength(2);
  });

  it('marks synced idempotently, and a second call changes nothing', async () => {
    const local = createPgliteBlobSyncLocal(db);
    const hash = 'd'.repeat(64);
    await insertBlob(db, hash);

    await local.markSynced(hash);
    await local.markSynced(hash);

    expect(await local.find(hash)).toMatchObject({ syncState: 'synced' });
    expect(await local.pending(10)).toEqual([]);
  });

  it('marking an unknown hash is a harmless no-op', async () => {
    const local = createPgliteBlobSyncLocal(db);

    await expect(local.markSynced('e'.repeat(64))).resolves.toBeUndefined();
    expect(await local.find('e'.repeat(64))).toBeNull();
  });

  it('registers a pulled blob as already durable', async () => {
    const local = createPgliteBlobSyncLocal(db);
    const hash = 'f'.repeat(64);

    await local.registerSynced({ hash, size: 42, mime: 'image/png' });

    expect(await local.find(hash)).toEqual({
      hash,
      size: 42,
      mime: 'image/png',
      syncState: 'synced',
    });
  });

  it('registering content the device already tracked promotes it instead of failing', async () => {
    const local = createPgliteBlobSyncLocal(db);
    const hash = '0'.repeat(64);
    await insertBlob(db, hash);

    await local.registerSynced({ hash, size: 10, mime: 'text/plain' });

    // Same hash means the same bytes, so the pre-existing row is right about
    // everything except that a durable copy now exists.
    expect(await local.find(hash)).toMatchObject({
      size: 10,
      syncState: 'synced',
    });
    expect(await local.pending(10)).toEqual([]);
  });
});
