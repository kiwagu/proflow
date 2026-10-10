import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, testId } from '../graph/graph.test-db.js';
import { migrate } from '../db/migrate.js';

let db: Awaited<ReturnType<typeof openTestDb>>;
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

it('accepts graph ids for blob metadata while rejecting malformed ids', async () => {
  await db.query(
    "insert into blob (hash, size, mime) values ('schema-test', 3, 'text/plain')"
  );
  const id = testId('knr');
  await expect(
    db.query(
      "insert into file_node (id, blob_hash, mime, size) values ($1, 'schema-test', 'text/plain', 3) returning id",
      [id]
    )
  ).resolves.toMatchObject({ rows: [{ id }] });
  await expect(
    db.query(
      "insert into file_node (id, blob_hash, mime, size) values ('broken', 'schema-test', 'text/plain', 3)"
    )
  ).rejects.toThrow(/check constraint/);
});

it('stores only blob metadata, never a second content tree', async () => {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'file_node'
     order by ordinal_position`
  );
  expect(rows.map((row) => row.column_name)).toEqual([
    'id',
    'mime',
    'size',
    'blob_hash',
  ]);
});

it('requires a reference to existing blob bytes metadata', async () => {
  await expect(
    db.query('insert into file_node (id, mime, size) values ($1, $2, $3)', [
      testId('knr'),
      'text/plain',
      3,
    ])
  ).rejects.toThrow(/not-null constraint/);
  await expect(
    db.query(
      'insert into file_node (id, mime, size, blob_hash) values ($1, $2, $3, $4)',
      [testId('knr'), 'text/plain', 3, 'missing-blob']
    )
  ).rejects.toThrow(/foreign key constraint/);
});

it('rebuilds a stale migration ledger and loses local rows exactly once', async () => {
  await db.query(
    "insert into blob (hash, size, mime) values ('before-reset', 1, 'text/plain')"
  );
  await db.query(
    "update schema_migration set checksum = 'stale' where version = 3"
  );
  await migrate(db as unknown as Parameters<typeof migrate>[0]);
  expect((await db.query('select * from blob')).rows).toEqual([]);
  expect((await db.query('select * from schema_migration')).rows).toHaveLength(
    8
  );
  await db.query(
    "insert into blob (hash, size, mime) values ('after-reset', 1, 'text/plain')"
  );
  await migrate(db as unknown as Parameters<typeof migrate>[0]);
  expect((await db.query('select hash from blob')).rows).toEqual([
    { hash: 'after-reset' },
  ]);
});
