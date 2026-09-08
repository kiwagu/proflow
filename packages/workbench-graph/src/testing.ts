import { cleanup } from '@testing-library/react';
import { newId } from '@workspace/domain';
import { createHashEmbedder } from '@workspace/embedding/testing';
import {
  createPgliteGraphReader,
  createPgliteGraphRepository,
  createPgliteSemanticSearch,
  type AppDb,
} from '@workspace/persistence-pglite';
import { openTestDatabase } from '@workspace/persistence-pglite/testing';
import type { GraphServices } from './graph-services.js';
import { localSearchProvider } from './search-provider.js';

/**
 * A real PGlite behind the ports, because what these surfaces exercise is the
 * store's behaviour: a recursive containment walk, an edge upsert on its
 * natural key, a live query firing after a write. A mocked repository would
 * assert the calls the hooks make, not what the drive does.
 */
export const TEST_USER = '00000000-0000-4000-8000-000000000001';
export const TEST_SPACE = 'spc_0000000000000001.0000000000';

export type TestGraph = {
  db: AppDb & { close: () => Promise<void> };
  services: GraphServices;
  /** Create a node, optionally inside a folder; returns its id. */
  node: (
    title: string,
    options?: { kind?: string; parentId?: string }
  ) => Promise<string>;
  /**
   * Store a document with content and index it for search; returns its id.
   * Only meaningful when the graph was opened `withSearch`.
   */
  document: (title: string, markdown: string) => Promise<string>;
  /** The failures the surface reported to the host during the case. */
  errors: string[];
};

export async function openTestGraph(
  options: {
    /**
     * Wire the local hybrid search engine (real PGlite vector + FTS, fused)
     * over a deterministic hash embedder — no model download, exact and
     * overlapping-token similarity only. Off by default: most surfaces
     * never search, and the host may legitimately wire no engine.
     */
    withSearch?: boolean;
  } = {}
): Promise<TestGraph> {
  const db = await openTestDatabase();

  const commands = createPgliteGraphRepository(db);
  const graph = createPgliteGraphReader(db);
  const errors: string[] = [];
  const engine = options.withSearch
    ? createPgliteSemanticSearch(db, createHashEmbedder())
    : null;

  const services: GraphServices = {
    graph,
    commands,
    spaceId: TEST_SPACE,
    userId: TEST_USER,
    ...(engine ? { search: localSearchProvider(engine) } : {}),
    onError: (message) => errors.push(message),
  };

  const node = async (
    title: string,
    options: { kind?: string; parentId?: string } = {}
  ): Promise<string> => {
    const result = await commands.createNode({
      spaceId: TEST_SPACE,
      kind: options.kind ?? 'folder',
      title,
      createdBy: TEST_USER,
      parentId: options.parentId ?? null,
    });
    if (result.isErr()) {
      throw new Error(result.error);
    }
    return result.value.id;
  };

  const document = async (
    title: string,
    markdown: string
  ): Promise<string> => {
    if (!engine) {
      throw new Error('openTestGraph({ withSearch: true }) is required');
    }
    const id = newId('document');
    // The engine reads exactly these two tables; seeding them directly keeps
    // the case about the search, not about the CRDT save path.
    await db.query('insert into document (id, title, preview) values ($1, $2, $3)', [
      id,
      title,
      markdown.slice(0, 120),
    ]);
    await db.query(
      `insert into document_content (document_id, lexical_json, markdown)
       values ($1, '{}'::jsonb, $2)`,
      [id, markdown]
    );
    const indexed = await engine.indexDocument(id);
    if (indexed.isErr()) {
      throw new Error(indexed.error);
    }
    return id;
  };

  return { db, services, node, document, errors };
}

/** A syntactically valid node id that is deliberately not in the replica. */
export function absentNodeId(): string {
  return newId('knowledgeResource');
}

/**
 * Tear a case down in the one order that works: unmount the tree, let the
 * live queries' unsubscribes land, and only then close the database.
 *
 * Both halves are load-bearing. A subscription released against a CLOSED
 * PGlite throws inside the live extension, where no test code can catch it —
 * the suite still passes but emits unhandled rejections and Vitest fails the
 * run. And the release is an async round trip, so unmounting alone is not
 * enough; the close has to wait for it. Ordering also has to be forced here
 * rather than left to the library's own auto-cleanup, because Vitest runs
 * `afterEach` hooks in reverse registration order.
 */
export async function closeTestGraph(open: TestGraph | null): Promise<void> {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await open?.db.close();
}
