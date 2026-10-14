import { entityIdRegistry, unsafeBrandEntityId } from '@workspace/entity-id';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createDocumentCrdtStore,
  createGraphFileRepository,
  createPgliteDocumentRepository,
  createPgliteGraphReplicaWriter,
  createPgliteGraphSyncLedger,
} from '@workspace/persistence-pglite';
import {
  openTestDb,
  testId,
  TEST_USER,
} from '@workspace/persistence-pglite/testing/graph';
import { createGraphSync } from './graph-sync.js';
import type { GraphRowTransport, RowRecord } from './types.js';

let db: Awaited<ReturnType<typeof openTestDb>>;
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

it('keeps an offline-created document openable after push, pull and inventory', async () => {
  const spaceId = entityIdRegistry.factories.spaceIdFactory.brand(
    testId('spc')
  );
  const documents = createPgliteDocumentRepository(
    db,
    createDocumentCrdtStore(db),
    spaceId,
    TEST_USER
  );
  const doc = (
    await documents.create({ title: 'Offline draft' })
  )._unsafeUnwrap();
  const ledger = createPgliteGraphSyncLedger(db);
  const replica = createPgliteGraphReplicaWriter(db);
  expect(await ledger.pendingCount(spaceId)).toBe(1);
  const accepted: RowRecord[] = [];
  const transport: GraphRowTransport = {
    async write(write) {
      expect(write.kind).toBe('upsert');
      if (write.kind !== 'upsert' || write.table !== 'knowledge_resources')
        throw new Error('Unexpected write');
      // Server defaults are independent of the local row: omitted body_ref becomes null.
      accepted.push({
        body_ref: null,
        created_at: new Date(),
        updated_at: new Date(),
        ...write.row,
        id: unsafeBrandEntityId(String(write.row['id'])),
      });
    },
    async pullSince() {
      return { rows: accepted, hasMore: false };
    },
    async inventory() {
      return accepted.map((row) => row.id);
    },
    async pullByNodes() {
      return accepted;
    },
    subscribe() {
      return () => {};
    },
  };
  const sync = createGraphSync({
    transport,
    replica: { ...ledger, ...replica },
    identity: { userId: TEST_USER },
  });
  await sync.push(spaceId);
  expect(await ledger.pendingCount(spaceId)).toBe(0);
  expect(accepted).toHaveLength(1);
  await replica.applyPullBatch('knowledge_resources', accepted);
  const files = createGraphFileRepository(
    db,
    {} as Parameters<typeof createGraphFileRepository>[1],
    spaceId,
    TEST_USER
  );
  async function expectOpenable() {
    const node = (await files.get(accepted[0]!.id))._unsafeUnwrap();
    expect(node.documentId).toBe(doc.id);
    expect(
      (await documents.load(node.documentId!))._unsafeUnwrap().meta.id
    ).toBe(doc.id);
  }
  await expectOpenable();
  expect(
    await ledger.applyInventory(
      spaceId,
      'knowledge_resources',
      accepted.map((row) => row.id)
    )
  ).toBe(0);
  await expectOpenable();
});
