import './index.css';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { ISettingsStore } from '@workspace/domain';
import { createWorkerEmbedder } from '@workspace/embedding';
import {
  createPgliteSemanticSearch,
  nodeOwnerOfDocument,
} from '@workspace/persistence-pglite';
import {
  AgentProvider,
  startAgentWorker,
  type AgentWorkerClient,
} from '@workspace/workbench-agent';
import { App } from './app';
import { AppServicesProvider } from './composition/app-services';
import { createAppServices, pendingBootSteps } from './composition/root';
import { BootFailure } from './shell/boot-failure';
import { BootShell } from './shell/boot-shell';
import {
  readSession,
  signIn,
  platformPath,
  authCookieFingerprint,
  forgetSession,
  recallSession,
  rememberSession,
  SessionUnreachable,
  type WorkbenchSession,
} from './composition/session';
import { installOfflineShell } from './shell/offline-shell';
import {
  createOperationErrors,
  OperationErrorsView,
  type FailureText,
  type ReportOptions,
} from './shell/operation-errors';
import { startDocumentSync } from './composition/document-sync';
import { rememberSyncSettings, startGraphSync } from './composition/sync';
import { allowed } from '@workspace/knowledge-contracts';
import { guardDocumentWrites } from './composition/agent-documents';

const container = requireRoot();

/**
 * The first value a live query yields, as a promise.
 *
 * The agent's list tools want one answer, not a subscription; the readers
 * only offer a watch, so the watch is opened, read once and closed. The
 * unsubscribe is deferred because a reader may call back synchronously,
 * before it has a subscription to cancel.
 */
function firstOf<T>(watch: (onValue: (value: T) => void) => () => void) {
  return new Promise<T>((resolve) => {
    const unsubscribe = watch((value) => {
      resolve(value);
      queueMicrotask(unsubscribe);
    });
  });
}

function requireRoot(): HTMLElement {
  const el = document.getElementById('root');
  if (!el) throw new Error('#root missing in index.html');
  return el;
}

/**
 * A start-up that is merely slow is not a failure: opening a large local
 * database takes a moment. The shell below shows the app's own frame while
 * it happens (and starts explaining itself once the wait grows noticeable);
 * only a wait long past any plausible one is called a failure.
 */
const BOOT_TIMEOUT_MS = 120_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const stuck = pendingBootSteps();
      reject(
        new Error(
          stuck.length > 0
            ? `${stuck.join(' and ')} did not open in ${Math.round(ms / 1000)}s`
            : `the app did not finish starting in ${Math.round(ms / 1000)}s`
        )
      );
    }, ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** One React root for the whole life of the page; each hand-off re-renders it. */
let root: Root | undefined;
function takeOver(view: ReactNode) {
  if (!root) {
    container.replaceChildren();
    root = createRoot(container);
  }
  root.render(view);
}

/**
 * Failures the user caused (a rename that collided, an import that failed)
 * and failures the app met on their behalf (a save refused, a push that did
 * not go through) are reported here. The channel is what the user sees; the
 * console keeps the same record for whoever is debugging.
 */
const errors = createOperationErrors();
function reportError(message: FailureText, options?: ReportOptions) {
  console.error(message);
  errors.report(message, options);
}
const resolveError = (key: string) => errors.resolve(key);

/** The one-line reason a failure carries, for a notice. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The replication target the server last stated, and where to keep it.
 *
 * The server's answer arrives before the local store exists (the session is
 * checked first, so the database is opened under the right account), so the
 * newest one is held here until there is somewhere to put it and written
 * from then on by every online check. Only an online answer carries one —
 * the recalled offline session deliberately does not.
 */
let syncSettings: ISettingsStore | undefined;
let latestSyncTarget: { url: string; key: string } | undefined;

function noteSyncTarget(session: WorkbenchSession | null) {
  if (!session?.sync) return;
  latestSyncTarget = session.sync;
  if (syncSettings) void rememberSyncSettings(syncSettings, session.sync);
}

/**
 * The frame first, the services behind it. The static boot screen in
 * index.html paints before any script runs; the shell replaces it as soon
 * as the bundle executes, and the full app replaces the shell when its
 * services are open — same chrome, same panel width, so the second
 * hand-off reads as content arriving, not as a new page. A failure here
 * has no UI to report itself in, which is why it builds its own.
 */
takeOver(<BootShell />);
// Installed before the session is checked: the worker is what makes the
// next reload work, and whether this one reached the server is beside the
// point. Its scope is this app's mount, so nothing else on the origin is
// affected.
installOfflineShell(
  // A Vite build-time constant computed from the configured base, not an
  // environment variable — the lint rule that tracks env reads for cache
  // invalidation cannot tell the two apart.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  import.meta.env.BASE_URL
);
try {
  const opening = await openingSession();
  if (!opening.session) {
    forgetSession();
    signIn();
  } else if (!opening.session.spaceId) {
    takeOver(
      <div className="p-6" data-testid="workbench-no-space">
        <p>Choose or create a space to open Workbench.</p>
        <a href={platformPath}>Open Platform</a>
        <a className="ml-4" href={platformPath + '/auth/signout'}>
          Sign out
        </a>
      </div>
    );
  } else {
    await openWorkbench(opening.session, opening.offline);
  }
} catch (error) {
  console.error('the workbench failed to start', error);
  takeOver(<BootFailure error={error} />);
}

/**
 * The identity to open with, and whether the server was reached for it.
 *
 * Normally the server's answer, which is the only one that can grant
 * access to a new account. When the server cannot be reached at all — and
 * only then — the last identity it confirmed is used instead, provided the
 * same account's cookies are still in the browser. Everything it opens is
 * already on this device, under that account's namespace, and the next
 * successful check has the last word, including signing the user out.
 *
 * Without this the offline promise would hold only for a tab that never
 * reloads: the app would fail to start over a database sitting intact.
 */
async function openingSession(): Promise<{
  session: WorkbenchSession | null;
  offline: boolean;
}> {
  try {
    const session = await readSession();
    if (session) {
      noteSyncTarget(session);
      rememberSession(session);
    } else forgetSession();
    return { session, offline: false };
  } catch (error) {
    if (!(error instanceof SessionUnreachable)) throw error;
    const remembered = recallSession();
    if (!remembered) throw error;
    return { session: remembered, offline: true };
  }
}

async function openWorkbench(session: WorkbenchSession, offline: boolean) {
  const services = await withTimeout(
    createAppServices({ report: reportError, resolve: resolveError }, session),
    BOOT_TIMEOUT_MS
  );
  // A session may have changed while the database was opening. Offline
  // there is nothing to ask: the identity was already taken from the last
  // confirmed one, and the recheck below runs the moment the server is
  // reachable again.
  if (!offline) {
    const latest = await readSession();
    if (!latest) {
      forgetSession();
      signIn();
      return;
    }
    noteSyncTarget(latest);
    services.writeScope.accept(latest.writeScope);
    if (
      latest.userId !== session.userId ||
      latest.spaceId !== session.spaceId
    ) {
      window.location.reload();
      return;
    }
  }
  /**
   * One worker for the life of the page, started here rather than in a
   * component so that no remount can give the page a second one — and a
   * change of user or space reloads the page (above), which starts a fresh
   * worker against the new session by itself.
   *
   * The worker opens no database of its own: the local one is exclusive, so
   * the agent's tools reach it through these ports, served from the single
   * client this page owns. `search` is built here for the same reason — it is
   * the only consumer, and a second embedder-backed index in the worker would
   * have needed a second database to live in.
   *
   * Having no agent is a working state, not a failure: an environment
   * without workers still has to be a full editor, so a start-up that
   * throws is reported and the page goes on without one.
   */
  let agentClient: AgentWorkerClient | undefined;
  try {
    agentClient = startAgentWorker({
      documents: guardDocumentWrites(services.documents, {
        scope: () => services.writeScope.current(),
        userId: services.identity.userId,
        ownerOfDocument: (id) => nodeOwnerOfDocument(services.db, id),
      }),
      search: createPgliteSemanticSearch(services.db, createWorkerEmbedder()),
      listDocuments: () => firstOf(services.documentList.watchRecent),
      listFiles: () => firstOf(services.fileTree.watchAll),
    });
    // The worker builds its gateway from the configuration the page pushes,
    // and has none until it arrives — an unconfigured worker answers every
    // turn with a provider error. The worker re-asks for this on every
    // restart by itself, so one push here covers the life of the page.
    // No provider key is held anywhere yet, so this selects the scripted
    // local model; choosing a provider is a later slice.
    const apiKey = null;
    agentClient.configure({ provider: 'mock', apiKey });
  } catch (error) {
    console.error('the agent worker did not start', error);
  }
  const app = (
    <AppServicesProvider services={services}>
      <App />
    </AppServicesProvider>
  );
  const view = (
    <div className="flex h-full flex-col" data-testid="workbench-ready">
      <nav
        aria-label="Account"
        className="flex items-center gap-4 border-b px-4 py-2 text-sm"
      >
        <span data-testid="workbench-user">{session.email}</span>
        <a href={platformPath} data-testid="workbench-space">
          {session.spaceName}
        </a>
        <a
          href={platformPath + '/auth/signout'}
          data-testid="workbench-signout"
        >
          Sign out
        </a>
      </nav>
      <div className="min-h-0 flex-1">
        {agentClient ? (
          <AgentProvider client={agentClient}>{app}</AgentProvider>
        ) : (
          app
        )}
      </div>
      {/* Below the app, in the column: it takes room instead of covering. */}
      <OperationErrorsView errors={errors} />
    </div>
  );
  takeOver(view);
  let checking = false;
  // Cookie changes invalidate the in-memory identity. They are only a signal
  // to recheck the server, never a source of trusted identity themselves.
  let verifiedCookies = authCookieFingerprint();
  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  notice.style.cssText =
    'position:fixed;inset:0;display:none;place-content:center;background:Canvas;color:CanvasText;padding:2rem;z-index:1000';
  notice.textContent = 'Connection lost. Reconnecting to verify your session…';
  document.body.append(notice);
  if (offline) {
    // Started from the last confirmed identity with no server in reach.
    // The user is told so at once rather than after the first poll, and
    // the loop below clears it the moment a check succeeds.
    notice.style.inset = 'auto 0 0';
    notice.textContent = 'Offline. Changes are saved on this device.';
    notice.style.display = 'grid';
  }
  /**
   * Replication starts here, after the local store is open and the identity
   * has been re-checked — never before, because there would be nowhere to
   * put what the server sends and no confirmed space to converge.
   *
   * Nothing is awaited: an app whose start-up waited on the network would
   * no longer be local-first. Starting is a decision the module makes for
   * itself and re-makes when the network returns.
   */
  syncSettings = services.settings;
  if (latestSyncTarget)
    await rememberSyncSettings(services.settings, latestSyncTarget);
  // Document bodies replicate beside the graph, from the same stored target
  // and on the same conditions. Their failures are their own notices: a
  // document's push under its own key, a feed pass under a key of its own —
  // not the graph's `sync`, which a completed document pass must not
  // withdraw while graph changes are still waiting.
  const documentSync = startDocumentSync({
    db: services.db,
    settings: services.settings,
    store: services.documentCrdt,
    identity: services.identity,
    onPushFailed: (documentId, error) => {
      console.error('document push failed', documentId, error);
      // Named by title: the notice is for the user, who does not know ids.
      void services.documents.load(documentId).then((result) => {
        const title = result.isOk() ? result.value.meta.title : documentId;
        errors.report(
          { kind: 'push', title, reason: reasonOf(error) },
          { key: `push:${documentId}` }
        );
      });
    },
    onPushed: (documentId) => resolveError(`push:${documentId}`),
    onPassFailed: (error) => {
      console.error('document replication pass failed', error);
      errors.report(
        { kind: 'pull', reason: reasonOf(error) },
        { key: 'document-sync' }
      );
    },
    onPassSettled: () => resolveError('document-sync'),
    mayWrite: (row) =>
      allowed(
        services.writeScope.current(),
        'body.write',
        row,
        services.identity.userId
      ),
  });
  startGraphSync({
    db: services.db,
    settings: services.settings,
    // The services were built from this session, and building them requires
    // a space — so by here the identity is the one they were opened under.
    identity: services.identity,
    onReconciled: ({ refused, nodeIds }) => {
      // The server refused a change made here and the affected items were
      // re-read from it. Saying so is not an error report: nothing is lost
      // locally and nothing is required of the user — this is the same
      // banner, borrowed for a moment.
      notice.style.inset = 'auto 0 0';
      notice.textContent = `Refreshed ${nodeIds.length === 1 ? '1 item' : `${nodeIds.length} items`} from the server: ${refused === 1 ? 'a change' : `${refused} changes`} made here could not be applied.`;
      notice.style.display = 'grid';
      window.setTimeout(() => {
        if (notice.textContent?.startsWith('Refreshed'))
          notice.style.display = 'none';
      }, 8_000);
    },
    onError: (error: unknown) => {
      // A replication pass that failed is not a failure of the app: the
      // journal keeps the work and the next pass retries it. The user is
      // told once — under one key, so the poll replaces rather than stacks —
      // and the next pass that completes withdraws it.
      console.error('graph replication pass failed', error);
      errors.report({ kind: 'sync', reason: reasonOf(error) }, { key: 'sync' });
    },
    // Writes could not reach the server: the journal keeps them and the
    // next pass retries, but the user is told their changes are waiting.
    onStalled: () => errors.report({ kind: 'sync-stalled' }, { key: 'sync' }),
    onSettled: () => resolveError('sync'),
    // New nodes may point at document bodies this device has no row for.
    onPulled: (outcome) => {
      if (outcome.applied > 0) documentSync.graphPulled();
    },
    // A node made here is on the server now: its document can be registered.
    onPushed: () => documentSync.graphPushed(),
  });
  const check = async () => {
    if (checking || document.visibilityState === 'hidden') return;
    checking = true;
    if (authCookieFingerprint() !== verifiedCookies) {
      container.inert = true;
      container.style.visibility = 'hidden';
    }
    try {
      const next = await readSession();
      if (!next) {
        container.inert = true;
        container.style.visibility = 'hidden';
        forgetSession();
        signIn();
        return;
      }
      if (next.userId !== session.userId || next.spaceId !== session.spaceId) {
        container.inert = true;
        container.style.visibility = 'hidden';
        window.location.reload();
        return;
      }
      container.inert = false;
      container.style.visibility = '';
      verifiedCookies = authCookieFingerprint();
      noteSyncTarget(next);
      rememberSession(next);
      services.writeScope.accept(next.writeScope);
      notice.style.display = 'none';
    } catch (error) {
      console.error('session verification failed', error);
      if (authCookieFingerprint() === verifiedCookies) {
        // An already verified account can keep editing locally during an
        // outage. Opening a new account still requires server verification.
        container.inert = false;
        container.style.visibility = '';
        notice.style.inset = 'auto 0 0';
        notice.textContent = 'Offline. Changes are saved on this device.';
      } else {
        notice.style.inset = '0';
        notice.textContent =
          'Connection lost. Reconnecting to verify your session…';
      }
      notice.style.display = 'grid';
    } finally {
      checking = false;
    }
  };
  window.addEventListener('focus', () => void check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      container.inert = true;
      container.style.visibility = 'hidden';
    } else void check();
  });
  window.addEventListener('pageshow', () => void check());
  window.setInterval(() => void check(), 15_000);
}
