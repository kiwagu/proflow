import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@workspace/db';
import {
  createDocumentSync,
  createPgliteLedger,
  createSupabaseTransport,
  DocumentNotRegisteredError,
  type DocumentSync,
  type SpaceWatch,
} from '@workspace/doc-sync';
import type { ISettingsStore } from '@workspace/domain';
import {
  type DocumentId,
  entityIdRegistry,
  type SpaceId,
} from '@workspace/entity-id';
import {
  type AppDb,
  type DocumentCrdtStore,
  listAwaitingDocuments,
  listUnpushedDocuments,
  materializeDocuments,
  nodeAwaitsServer,
  nodeOwnerOfDocument,
  resourceIdForDocument,
} from '@workspace/persistence-pglite';
import { parseSyncSettings, SYNC_SETTINGS_KEY } from './sync';

/**
 * Document bodies, replicated beside the graph.
 *
 * Same conditions and the same stored target as graph replication: a
 * configuration received at least once, and the device on the network.
 * The graph carries the nodes; this carries what they point at, so a text
 * node that arrived through the graph gets its local document row here
 * (materialized), its first bytes by name, and every later change through
 * the space feed; a document edited here is pushed once the edit settles.
 *
 * Every tab runs its own engine over the shared local database. Two tabs
 * may push the same span or import the same rows; both are no-ops by the
 * protocol's design.
 */

/** A local change settles for this long before its document is pushed. */
export const PUSH_DEBOUNCE_MS = 1_000;

export interface StartDocumentSyncOptions {
  db: AppDb;
  settings: ISettingsStore;
  store: DocumentCrdtStore;
  /**
   * The server-verified session and the space currently checked out. The
   * user is the auth user UUID, not an entity id.
   */
  identity: { userId: string; spaceId: SpaceId };
  /**
   * A document's push did not go through. The journal keeps the bytes;
   * the next change to the document or the network returning tries again.
   */
  onPushFailed?: (documentId: DocumentId, error: unknown) => void;
  /** A push landed: whatever was reported failing for this document is through. */
  onPushed?: (documentId: DocumentId) => void;
  /** A feed pass, a pull or a catch-up failed; the next one retries. */
  onPassFailed?: (error: unknown) => void;
  /** A pass completed. */
  onPassSettled?: () => void;
  /**
   * Whether the person may write a document's body, asked with the owner of
   * the node it belongs to. A document they may only read is never pushed:
   * the server would refuse it. Absent, every document may be pushed.
   */
  mayWrite?: (row: { owner_user_id: string | null }) => boolean;
}

export interface DocumentSyncHandle {
  stop(): void;
  /**
   * The graph brought new rows: documents may need materializing and
   * pulling now rather than at the next start.
   */
  graphPulled(): void;
  /**
   * The graph carried local changes to the server: a node that was waiting
   * to be there is, and the bodies that waited for it may be registered.
   */
  graphPushed(): void;
}

export function startDocumentSync(
  options: StartDocumentSyncOptions
): DocumentSyncHandle {
  const { db, settings, store, identity } = options;
  // Minted per page: each tab is its own writer for echo suppression.
  const writer = entityIdRegistry.factories.writerIdFactory.create();
  let disposed = false;
  /** Set before the settings read, for the same reason graph sync does. */
  let starting = false;
  let engine: DocumentSync | null = null;
  let space: SpaceWatch | null = null;
  let unsubscribeChanges: (() => void) | null = null;
  const timers = new Map<DocumentId, ReturnType<typeof setTimeout>>();
  /**
   * Pushes that failed in this session. The catch-up query finds changed
   * documents by time, which a change racing a pull can slip past; what
   * failed here is retried by name as well.
   */
  const failed = new Set<DocumentId>();
  /**
   * Documents whose body cannot be registered yet: the node that owns it is
   * not on the server, or this device does not know the owner and the
   * creator has not registered it. Neither is a failure to tell the user
   * about, and neither can end before the graph moves.
   */
  const deferred = new Set<DocumentId>();

  const pushDocument = async (id: DocumentId) => {
    if (!engine || disposed) return;
    try {
      const doc = await store.syncable(id);
      if (!doc) return;
      // Read-only for this person: not a wait and not a failure. The scope
      // changing (a raised role) lets the next edit through.
      if (
        options.mayWrite &&
        !options.mayWrite({
          owner_user_id: await nodeOwnerOfDocument(db, id),
        })
      ) {
        deferred.delete(id);
        failed.delete(id);
        return;
      }
      // The server fences a body through the resource that owns it; this
      // device knows which node points at the document, and the server
      // takes the name once, when it first sees the document — from
      // someone who could edit that node, and only once the node is there.
      const resourceId = await resourceIdForDocument(db, id, identity.userId);
      if (resourceId !== null && (await nodeAwaitsServer(db, resourceId))) {
        deferred.add(id);
        return;
      }
      await engine.push(id, doc, identity.spaceId, resourceId);
      deferred.delete(id);
      failed.delete(id);
      options.onPushed?.(id);
    } catch (error) {
      // Not a failure: this device cannot register the document and its
      // creator has not. The graph moving on is what may change that.
      if (error instanceof DocumentNotRegisteredError) {
        deferred.add(id);
        return;
      }
      // Anything else is a verdict, not a wait: the graph moving on cannot
      // change it, so it is retried as a failure is (the next edit, the
      // network returning), never on every graph pass.
      deferred.delete(id);
      failed.add(id);
      options.onPushFailed?.(id, error);
    }
  };

  /** What waited for the graph: tried again whenever the graph moves. */
  const retryDeferred = async () => {
    for (const id of [...deferred]) await pushDocument(id);
  };

  const schedulePush = (id: DocumentId) => {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void pushDocument(id);
      }, PUSH_DEBOUNCE_MS)
    );
  };

  /**
   * Every document with changes the server may not have. The engine skips
   * a document whose version is what it last pushed, so a candidate that
   * turns out to be in step costs one comparison; documents known to be in
   * step are not opened at all. This is also what uploads documents
   * written before replication existed.
   */
  const catchUp = async () => {
    const ids = new Set([...(await listUnpushedDocuments(db)), ...failed]);
    for (const id of ids) await pushDocument(id);
  };

  /**
   * Documents this device knows only from the graph get their first bytes
   * by name: the space feed skips a head it has no row for, so a row
   * created after the feed saw its head would otherwise wait for the
   * document's next change.
   */
  const pullAwaiting = async () => {
    for (const id of await listAwaitingDocuments(db)) {
      if (!engine || disposed) return;
      const doc = await store.syncable(id);
      if (!doc) continue;
      await engine.pull(id, doc);
      // The wait is over, with a body or without one. A body is announced
      // as a merge; an empty answer merges nothing and would leave a pane
      // that opened a moment earlier waiting for ever.
      store.settled(id);
    }
  };

  const materialize = async () => {
    await materializeDocuments(db, identity.spaceId);
    await pullAwaiting();
    space?.kick();
  };

  const report = (work: Promise<unknown>) =>
    void work.catch((error: unknown) => options.onPassFailed?.(error));

  const begin = () => {
    if (disposed || starting || !navigator.onLine) return;
    starting = true;
    void (async () => {
      try {
        const stored = await settings.get(SYNC_SETTINGS_KEY);
        const config = stored.isOk() ? parseSyncSettings(stored.value) : null;
        if (!config) {
          // Never configured: nothing to replicate to; retried when the
          // network changes, exactly as graph replication is.
          starting = false;
          return;
        }
        if (disposed) return;
        const client = createBrowserClient<Database>(config.url, config.key);
        engine = createDocumentSync({
          transport: createSupabaseTransport(client),
          ledger: createPgliteLedger(db),
          journal: store.syncJournal,
          writer,
        });
        await materializeDocuments(db, identity.spaceId);
        if (disposed) return;
        space = engine.watchSpace(identity.spaceId, {
          open: (id) => store.syncable(id),
          onPass: () => options.onPassSettled?.(),
          onError: (error) => options.onPassFailed?.(error),
        });
        unsubscribeChanges = store.onChanged((event) => {
          // The local store's own document ids: its table CHECKs them.
          if (event.source === 'local' || event.localEdits)
            schedulePush(
              entityIdRegistry.factories.documentIdFactory.brand(event.id)
            );
        });
        await pullAwaiting();
        await catchUp();
      } catch (error) {
        // Without a feed nothing would ever retry: start over on the next
        // network change. With one, this was a failed pull or catch-up,
        // which the feed and the next catch-up retry by themselves.
        if (!space) {
          engine = null;
          starting = false;
        }
        options.onPassFailed?.(error);
      }
    })();
  };

  const onOnline = () => {
    if (!engine) {
      begin();
      return;
    }
    report(materialize().then(catchUp));
  };
  window.addEventListener('online', onOnline);
  begin();

  return {
    stop() {
      disposed = true;
      window.removeEventListener('online', onOnline);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      unsubscribeChanges?.();
      space?.stop();
      space = null;
      engine = null;
    },
    graphPulled() {
      if (engine) report(materialize().then(retryDeferred));
    },
    graphPushed() {
      if (engine && deferred.size > 0) report(retryDeferred());
    },
  };
}
