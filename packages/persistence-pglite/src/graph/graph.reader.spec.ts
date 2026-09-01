import { describe, expect, it } from 'vitest';
import { openTestDb, testId, TEST_USER } from './graph.test-db.js';
import { createPgliteGraphReader } from './graph.reader.js';
import { createPgliteGraphRepository } from './graph.repository.js';

/**
 * What the reader is asked in production is the workbench's whole question
 * list, so the suite seeds a real space through the repository (the only way
 * rows get there locally) and reads it back the way a view would.
 */
async function seedSpace() {
  const db = await openTestDb();
  const repo = createPgliteGraphRepository(db);
  const reader = createPgliteGraphReader(db);
  const spaceId = testId('spc');

  const create = async (
    kind: string,
    title: string,
    parentId?: string
  ): Promise<string> => {
    const result = await repo.createNode({
      spaceId,
      kind,
      title,
      createdBy: TEST_USER,
      parentId: parentId ?? null,
    });
    if (result.isErr()) throw new Error(result.error);
    return result.value.id;
  };

  /**
   * Closing while a live query is still attached leaves the extension's next
   * refresh running against a closed database, which surfaces as an
   * unhandled rejection rather than a test failure. Detaching is async, so
   * the close waits a tick for it to land.
   */
  const close = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await db.close();
  };

  return { db, repo, reader, spaceId, create, close };
}

describe('graph reader', () => {
  it('lists a space in the live lens and hides trashed nodes', async () => {
    const { reader, repo, spaceId, create, close } = await seedSpace();
    const keep = await create('text', 'Kept');
    const gone = await create('text', 'Discarded');

    expect((await repo.trashNode(gone, TEST_USER)).isOk()).toBe(true);

    const live = await reader.readNodes(spaceId, 'live');
    expect(live.map((node) => node.id)).toEqual([keep]);

    const trashed = await reader.readNodes(spaceId, 'trashed');
    expect(trashed.map((node) => node.id)).toEqual([gone]);
    // Trash is not a table: the same row, in the other lens, still carrying
    // who put it there.
    expect(trashed[0]?.trashedBy).toBe(TEST_USER);
    expect(trashed[0]?.deletedAt).toBeInstanceOf(Date);

    await close();
  });

  it('walks the containment forest up and down, ignoring shortcuts', async () => {
    const { reader, repo, spaceId, create, close } = await seedSpace();
    const root = await create('folder', 'Root');
    const mid = await create('folder', 'Mid', root);
    const leaf = await create('text', 'Leaf', mid);
    const elsewhere = await create('folder', 'Elsewhere');

    // A shortcut points at the leaf from an unrelated folder. It renders in
    // the workbench but must never be traversed, or it would fabricate an
    // ancestor and could close a cycle.
    expect(
      (
        await repo.upsertEdge({
          spaceId,
          from: elsewhere,
          to: leaf,
          relationType: 'shortcut',
          createdBy: TEST_USER,
        })
      ).isOk()
    ).toBe(true);

    const ancestors = await reader.readAncestors(leaf);
    expect(ancestors.map((node) => node.id)).toEqual([mid, root]);

    const descendants = await reader.readDescendantIds(root);
    expect(new Set(descendants)).toEqual(new Set([mid, leaf]));

    expect((await reader.readEdges(spaceId, 'shortcut')).map((e) => e.to)).toEqual([
      leaf,
    ]);

    await close();
  });

  it('joins the kb satellites of a node into one attribute set', async () => {
    const { db, repo, reader, spaceId, create, close } = await seedSpace();
    const node = await create('file', 'Report');
    const bare = await create('text', 'No satellites');

    expect((await repo.setDescription(node, 'What it covers', TEST_USER)).isOk()).toBe(
      true
    );
    const blobId = testId('kmb');
    await db.query(
      `insert into kb_media_blob
         (id, space_id, storage_bucket, storage_path, mime_type, size_bytes,
          duration_ms, uploaded_by)
       values ($1, $2, 'kb-media', $3, 'application/pdf', 4096, null, $4)`,
      [blobId, spaceId, `spaces/${spaceId}/kb/${node}/report.pdf`, TEST_USER]
    );
    await db.query(
      `insert into kb_resource_media_meta
         (id, node_id, space_id, blob_id, original_filename, created_by)
       values ($1, $2, $3, $4, 'report.pdf', $5)`,
      [testId('kmm'), node, spaceId, blobId, TEST_USER]
    );

    const attributes = await new Promise<Record<string, unknown>>((resolve) => {
      const stop = reader.watchKbAttributes(spaceId, (byNode) => {
        if (byNode[node]) {
          stop();
          resolve(byNode as Record<string, unknown>);
        }
      });
    });

    expect(attributes[node]).toEqual({
      description: 'What it covers',
      media: {
        byteSize: 4096,
        durationMs: null,
        mimeType: 'application/pdf',
        storagePath: `spaces/${spaceId}/kb/${node}/report.pdf`,
        originalFilename: 'report.pdf',
      },
    });
    // A node with no satellite row carries no entry at all — absent, never a
    // filled-in default.
    expect(attributes[bare]).toBeUndefined();

    await close();
  });

  it('resolves per-node tags over forward tagged edges', async () => {
    const { reader, repo, spaceId, create, close } = await seedSpace();
    const doc = await create('text', 'Tagged doc');
    const urgent = await create('tag', 'Urgent');
    const stale = await create('tag', 'Obsolete');

    for (const tag of [urgent, stale]) {
      expect(
        (
          await repo.upsertEdge({
            spaceId,
            from: doc,
            to: tag,
            relationType: 'tagged',
            createdBy: TEST_USER,
          })
        ).isOk()
      ).toBe(true);
    }
    // A trashed tag drops out of the projection: the edge survives, but the
    // tag is no longer part of the space's vocabulary.
    expect((await repo.trashNode(stale, TEST_USER)).isOk()).toBe(true);

    const tags = await new Promise<Record<string, { title: string }[]>>(
      (resolve) => {
        const stop = reader.watchResourceTags(spaceId, (byNode) => {
          stop();
          resolve(byNode);
        });
      }
    );
    expect(tags[doc]?.map((tag) => tag.title)).toEqual(['Urgent']);

    await close();
  });

  it('finds nodes by a partially typed title and never a trashed one', async () => {
    const { reader, repo, spaceId, create, close } = await seedSpace();
    await create('text', 'Quarterly Revenue Plan');
    await create('text', 'Unrelated');
    const trashed = await create('text', 'Quarterly Retro');
    expect((await repo.trashNode(trashed, TEST_USER)).isOk()).toBe(true);

    const typing = await reader.searchByTitle(spaceId, 'quar rev');
    expect(typing.map((node) => node.title)).toEqual(['Quarterly Revenue Plan']);

    const midWord = await reader.searchByTitle(spaceId, 'venue');
    expect(midWord.map((node) => node.title)).toEqual(['Quarterly Revenue Plan']);

    expect(await reader.searchByTitle(spaceId, '   ')).toEqual([]);
    expect(
      (await reader.searchByTitle(spaceId, 'Quarterly')).map((n) => n.title)
    ).toEqual(['Quarterly Revenue Plan']);

    await close();
  });

  it('delivers node changes to an open subscription', async () => {
    const { reader, repo, spaceId, create, close } = await seedSpace();
    const node = await create('text', 'Before');

    const renamed = new Promise<string>((resolve) => {
      let seen = false;
      const stop = reader.watchNodes(spaceId, 'live', (nodes) => {
        const title = nodes[0]?.title;
        if (title === 'After') {
          stop();
          resolve(title);
        }
        if (!seen && title === 'Before') {
          seen = true;
          void repo.renameNode(node, 'After');
        }
      });
    });

    expect(await renamed).toBe('After');
    await close();
  });
});
