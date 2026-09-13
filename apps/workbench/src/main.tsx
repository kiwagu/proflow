import './index.css';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { createWorkerEmbedder } from '@workspace/embedding';
import { createPgliteSemanticSearch } from '@workspace/persistence-pglite';
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
 * are reported here. A toaster is a later slice; until then the console is
 * the one place that always exists.
 */
function reportError(message: string) {
  console.error(message);
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
    if (session) rememberSession(session);
    else forgetSession();
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
    createAppServices(reportError, session),
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
      documents: services.documents,
      search: createPgliteSemanticSearch(services.db, createWorkerEmbedder()),
      listDocuments: () => firstOf(services.documentList.watchRecent),
      listFiles: () => firstOf(services.fileTree.watchAll),
    });
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
      rememberSession(next);
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
