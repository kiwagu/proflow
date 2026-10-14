import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A document this browser knows only from the graph waits for its first
 * pull, and every pane showing it says so. Only the leader tab pulls; when
 * that pull ends — with a body or, as here, with none on the server — every
 * tab's pane must stop waiting, not just the leader's.
 *
 * Real parts below the composition: one PGlite carrying the app's
 * migrations, two document stores over it (two tabs), the real document
 * engine against a real Postgres standing in for the server, and the tabs'
 * real peers over a shared channel. Only the browser client and the graph
 * half are stood in for.
 */

const { server, createBrowserClient, startGraphSync } = vi.hoisted(() => {
  const server: { current: unknown } = { current: null };
  return {
    server,
    createBrowserClient: vi.fn(() => ({
      rpc: vi.fn(async () => ({
        data: [
          {
            epoch: 0,
            graph_changed_at: null,
            graph_deleted_at: null,
            documents_changed_at: null,
            probed_at: new Date().toISOString(),
          },
        ],
        error: null,
      })),
    })),
    startGraphSync: vi.fn(() => ({ stop: vi.fn(), kick: vi.fn() })),
  };
});

vi.mock('@supabase/ssr', () => ({ createBrowserClient }));
vi.mock('@workspace/doc-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@workspace/doc-sync')>()),
  createSupabaseTransport: () => server.current,
}));
vi.mock('./sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sync')>()),
  startGraphSync,
}));

import {
  createServerStandIn,
  type ServerStandIn,
} from '@workspace/doc-sync/testing';
import { entityIdRegistry } from '@workspace/entity-id';
import { ok } from 'neverthrow';
import {
  createDocumentCrdtStore,
  createPgliteDocumentRepository,
  createPgliteGraphReplicaWriter,
  materializeDocuments,
} from '@workspace/persistence-pglite';
import {
  openTestDb,
  testId,
  TEST_USER,
} from '@workspace/persistence-pglite/testing/graph';
import { startSync, type SyncHandle } from './sync-composition';
import { fakeChannelBus, fakeLocks } from './testing/sync-fakes';

const SPACE = entityIdRegistry.factories.spaceIdFactory.brand(testId('spc'));
const DOC = testId('doc');

let db: Awaited<ReturnType<typeof openTestDb>>;
let standIn: ServerStandIn;
const handles: SyncHandle[] = [];

beforeEach(async () => {
  db = await openTestDb();
  standIn = await createServerStandIn();
  server.current = standIn;
  // A text node another device made: it arrives through the graph alone,
  // and its body is not on the server either.
  const at = new Date();
  await createPgliteGraphReplicaWriter(db).applyPullBatch(
    'knowledge_resources',
    [
      {
        id: entityIdRegistry.factories.knowledgeResourceIdFactory.brand(
          testId('knr')
        ),
        space_id: SPACE,
        kind: 'text',
        title: 'From elsewhere',
        status: 'draft',
        visibility: 'space',
        created_by: TEST_USER,
        owner_user_id: TEST_USER,
        body_ref: { doc_id: DOC },
        last_modified_at: at,
        last_activity_at: at,
        created_at: at,
        updated_at: at,
      },
    ]
  );
  await materializeDocuments(db, SPACE);
}, 60_000);

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await standIn.close();
  await db.close();
});

describe('a document waiting for its first pull', () => {
  it("stops waiting in every tab of the browser once the leader's pull ends, without a reload", async () => {
    const locks = fakeLocks();
    const bus = fakeChannelBus();
    const settings = {
      get: vi.fn(async () =>
        ok(
          JSON.stringify({
            url: 'https://proflow.local/backend',
            key: 'pk',
            cookie: 'sb-api-auth-token',
          })
        )
      ),
      set: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const tab = (store: ReturnType<typeof createDocumentCrdtStore>) =>
      startSync({
        db,
        settings,
        store,
        identity: { userId: TEST_USER, spaceId: SPACE },
        onGraphJournaled: () => () => undefined,
        locks,
        channel: bus.open(),
        root: document.createElement('html'),
        page: {
          visible: () => true,
          onVisibilityChange: () => () => undefined,
        },
      });

    // The second tab: a pane over the document, waiting.
    const otherStore = createDocumentCrdtStore(db);
    const otherPane = createPgliteDocumentRepository(
      db,
      otherStore,
      SPACE,
      TEST_USER
    );
    const before = await otherPane.load(
      entityIdRegistry.factories.documentIdFactory.brand(DOC)
    );
    expect(before._unsafeUnwrap().awaitingSync).toBe(true);
    const settledThere: string[] = [];
    otherStore.onSettled((id) => settledThere.push(id));

    // The leader starts first and pulls; the other tab only listens.
    const leaderStore = createDocumentCrdtStore(db);
    const settledHere: string[] = [];
    leaderStore.onSettled((id) => settledHere.push(id));
    handles.push(tab(leaderStore));
    handles.push(tab(otherStore));

    await vi.waitFor(() => expect(settledHere).toEqual([DOC]), {
      timeout: 15_000,
    });
    await vi.waitFor(() => expect(settledThere).toEqual([DOC]), {
      timeout: 5_000,
    });
    // What the pane reads when told: no longer waiting — an empty document.
    const after = await otherPane.load(
      entityIdRegistry.factories.documentIdFactory.brand(DOC)
    );
    expect(after._unsafeUnwrap().awaitingSync).toBe(false);
  }, 60_000);
});
