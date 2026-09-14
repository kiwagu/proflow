/**
 * What restoring a version leaves behind in the derived cache.
 *
 * The tree is canonical and the cache beside it is derived, so the two must
 * never disagree: everything that reads `document_content.markdown` without
 * going through the tree — search, the attachment reachability query, storage
 * maintenance — would otherwise serve the text from before the restore until
 * the next save happened to overwrite it.
 *
 * This runs against a real PGlite with the app's own migrations, because what
 * is under test is what one transaction writes to a column.
 */
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SerializedTree } from '@workspace/doc-crdt';
import type { AppDb } from '../db/db.js';
import { openTestDb, testId } from '../graph/graph.test-db.js';
import { createDocumentCrdtStore } from './document.crdt-store.js';

const AUTHOR = { user: 'tester', src: 'human' as const };

/** A document tree parsed from markdown, every node carrying a stable id. */
function treeOf(markdown: string): SerializedTree {
  return markdownToState(markdown).state as unknown as SerializedTree;
}

describe('restoring a document to an earlier version', () => {
  let db: AppDb & { close: () => Promise<void> };

  beforeAll(async () => {
    db = await openTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  async function newDocument(): Promise<string> {
    const id = testId('doc');
    await db.query('insert into document (id, title) values ($1, $2)', [
      id,
      'restore',
    ]);
    return id;
  }

  it('leaves the derived markdown saying what the tree says', async () => {
    const store = createDocumentCrdtStore(db);
    const id = await newDocument();

    await store.save({
      id,
      tree: treeOf('v1'),
      markdown: 'v1',
      preview: 'v1',
      author: AUTHOR,
    });
    const first = await store.frontiers(id);
    await store.save({
      id,
      tree: treeOf('v1 v2'),
      markdown: 'v1 v2',
      preview: 'v1 v2',
      author: AUTHOR,
    });

    await store.restore(id, first, AUTHOR);

    const { rows } = await db.query<{ markdown: string }>(
      'select markdown from document_content where document_id = $1',
      [id]
    );
    // Read from the column, not from the store: a consumer that queries the
    // cache directly is exactly who this defect was invisible to.
    expect(rows[0]?.markdown.trim()).toBe('v1');
  });

  it('derives that markdown from the restored tree, not from the caller', async () => {
    const store = createDocumentCrdtStore(db);
    const id = await newDocument();

    // A document whose text the restore has no other way of knowing: nothing
    // hands it in, so a cache that matches can only have been derived.
    await store.save({
      id,
      tree: treeOf('# Heading\n\nbody'),
      markdown: '# Heading\n\nbody',
      preview: 'Heading',
      author: AUTHOR,
    });
    const heading = await store.frontiers(id);
    await store.save({
      id,
      tree: treeOf('replaced'),
      markdown: 'replaced',
      preview: 'replaced',
      author: AUTHOR,
    });

    await store.restore(id, heading, AUTHOR);

    const { rows } = await db.query<{ markdown: string }>(
      'select markdown from document_content where document_id = $1',
      [id]
    );
    expect(rows[0]?.markdown).toContain('# Heading');
    expect(rows[0]?.markdown).toContain('body');
    expect(rows[0]?.markdown).not.toContain('replaced');
  });
});
