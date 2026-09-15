/// <reference types="node" />
import { afterAll, beforeAll, expect, it } from 'vitest';
import process from 'node:process';
import type { IBlobStore, IPackageStore } from '@workspace/domain';
import { openTestDb, testId, TEST_USER } from '../graph/graph.test-db.js';
import { createPgliteGraphRepository } from '../graph/graph.repository.js';
import { createPgliteStorageMaintenance } from '../storage/storage.maintenance.js';
import { createGraphFileRepository } from './file.graph-repository.js';

let db: Awaited<ReturnType<typeof openTestDb>>;
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

function harness() {
  const hash = testId('knr');
  const stored = new Map<string, Blob>();
  const unpacked = new Set<string>();
  const blobs: IBlobStore = {
    put: async (blob) => {
      stored.set(hash, blob);
      unpacked.add(hash);
      return { hash, size: blob.size, mime: blob.type };
    },
    get: async (key) => stored.get(key) ?? null,
    has: async (key) => stored.has(key),
    delete: async (key) => {
      stored.delete(key);
    },
    list: async () =>
      [...stored].map(([key, blob]) => ({ hash: key, size: blob.size })),
    clear: async () => {
      stored.clear();
    },
  };
  const packages: IPackageStore = {
    unpack: async () => [],
    inspect: async () => [],
    readEntry: async () => null,
    remove: async (key) => {
      unpacked.delete(key);
    },
    list: async () => [...unpacked].map((key) => ({ hash: key, size: 10 })),
  };
  const files = createGraphFileRepository(
    db,
    blobs,
    testId('spc'),
    TEST_USER,
    packages
  );
  const maintenance = createPgliteStorageMaintenance(
    db,
    blobs,
    packages,
    files,
    {
      stats: async () => null,
      compact: async () => null,
    }
  );
  const importFile = async () =>
    (
      await files.importFile({
        name: 'file.txt',
        parentId: null,
        blob: new Blob(['hello'], { type: 'text/plain' }),
      })
    )._unsafeUnwrap();
  return { hash, blobs, unpacked, files, maintenance, importFile };
}

it.each(['trash', 'purge'] as const)(
  'reclaims bytes and blob rows after graph %s',
  async (operation) => {
    const h = harness();
    const file = await h.importFile();
    if (operation === 'trash')
      (await h.files.softDelete(file.id))._unsafeUnwrap();
    else
      (
        await createPgliteGraphRepository(db).purgeNode(file.id)
      )._unsafeUnwrap();
    const report = (await h.maintenance.report())._unsafeUnwrap();
    expect(report.files).toBe(0);
    expect(report.reclaimable).toBe(15);
    (await h.files.collectGarbage())._unsafeUnwrap();
    const rows = (
      await db.query('select hash from blob where hash = $1', [h.hash])
    ).rows;
    const kept = await h.blobs.has(h.hash);
    process.stdout.write(
      `PROBE_GC ${operation} new_bytes_kept=${kept} new_blob_rows=${rows.length}\n`
    );
    expect(kept).toBe(false);
    expect(rows).toEqual([]);
    expect(h.unpacked.has(h.hash)).toBe(false);
    expect(
      (await db.query('select id from file_node where id = $1', [file.id])).rows
    ).toEqual([]);
  }
);

it('keeps a shared hash until its last live graph reference is gone', async () => {
  const h = harness();
  const first = await h.importFile();
  const second = await h.importFile();
  (await h.files.softDelete(first.id))._unsafeUnwrap();
  (await h.files.collectGarbage())._unsafeUnwrap();
  expect(await h.blobs.has(h.hash)).toBe(true);
  expect((await h.maintenance.report())._unsafeUnwrap().files).toBe(5);
  (await h.files.softDelete(second.id))._unsafeUnwrap();
  expect((await h.maintenance.freeUnused())._unsafeUnwrap()).toBe(15);
  expect(await h.blobs.has(h.hash)).toBe(false);
});

it('trashes the full local contains subtree with one durable root operation', async () => {
  const h = harness();
  const parent = (
    await h.files.createFolder({ name: 'Parent', parentId: null })
  )._unsafeUnwrap();
  const child = (
    await h.files.createFolder({ name: 'Child', parentId: parent.id })
  )._unsafeUnwrap();
  const grand = await h.importFile();
  (await h.files.move(grand.id, child.id))._unsafeUnwrap();
  const before = (await db.query('select id from graph_op_journal')).rows
    .length;
  (await h.files.softDelete(parent.id))._unsafeUnwrap();
  const { rows } = await db.query<{
    deleted_at: Date | null;
    trashed_by: string;
  }>(
    'select deleted_at, trashed_by from knowledge_resources where id = any($1)',
    [[parent.id, child.id, grand.id]]
  );
  const childMissing = (await h.files.get(child.id)).isErr();
  process.stdout.write(
    `PROBE_SUBTREE deleted=${rows.filter((r) => r.deleted_at !== null).length}/3 child_err=${childMissing}\n`
  );
  expect(rows).toHaveLength(3);
  expect(
    rows.every((r) => r.deleted_at !== null && r.trashed_by === TEST_USER)
  ).toBe(true);
  expect(new Set(rows.map((r) => String(r.deleted_at))).size).toBe(1);
  expect(childMissing).toBe(true);
  expect((await h.files.get(grand.id)).isErr()).toBe(true);
  expect((await db.query('select id from graph_op_journal')).rows).toHaveLength(
    before + 1
  );
  (await h.files.collectGarbage())._unsafeUnwrap();
  expect(await h.blobs.has(h.hash)).toBe(false);
});

it.each(['trash', 'purge'] as const)(
  'keeps document attachments only while their graph document is live before %s',
  async (operation) => {
    const h = harness();
    const file = await h.importFile();
    const docId = testId('doc');
    const spaceId = testId('spc');
    await db.query(
      'insert into document (id, title, kind) values ($1, $2, $3)',
      [docId, 'Attachment', 'md']
    );
    await db.query(
      'insert into document_content (document_id, lexical_json, markdown) values ($1, $2, $3)',
      [docId, '{}', h.hash]
    );
    const graph = createPgliteGraphRepository(db);
    const node = (
      await graph.createNode({
        spaceId,
        createdBy: TEST_USER,
        kind: 'text',
        title: 'Attachment',
        body_ref: { doc_id: docId },
      })
    )._unsafeUnwrap();
    (await h.files.softDelete(file.id))._unsafeUnwrap();
    (await h.files.collectGarbage())._unsafeUnwrap();
    expect(await h.blobs.has(h.hash)).toBe(true);
    expect((await h.maintenance.report())._unsafeUnwrap().files).toBe(5);
    if (operation === 'trash')
      (await graph.trashNode(node.id, TEST_USER))._unsafeUnwrap();
    else (await graph.purgeNode(node.id))._unsafeUnwrap();
    expect((await h.maintenance.report())._unsafeUnwrap().files).toBe(0);
    (await h.files.collectGarbage())._unsafeUnwrap();
    expect(await h.blobs.has(h.hash)).toBe(false);
  }
);

it('rolls back the root and journal if the local cascade is refused', async () => {
  const h = harness();
  const parent = (
    await h.files.createFolder({ name: 'Rollback root', parentId: null })
  )._unsafeUnwrap();
  const child = (
    await h.files.createFolder({ name: 'Rollback leaf', parentId: parent.id })
  )._unsafeUnwrap();
  const before = (await db.query('select id from graph_op_journal')).rows
    .length;
  await db.exec(
    "alter table knowledge_resources add constraint refuse_cascade check (title <> 'Rollback leaf' or deleted_at is null) not valid"
  );
  try {
    expect((await h.files.softDelete(parent.id)).isErr()).toBe(true);
    expect((await h.files.get(parent.id)).isOk()).toBe(true);
    expect((await h.files.get(child.id)).isOk()).toBe(true);
    expect(
      (await db.query('select id from graph_op_journal')).rows
    ).toHaveLength(before);
  } finally {
    await db.exec(
      'alter table knowledge_resources drop constraint refuse_cascade'
    );
  }
});
