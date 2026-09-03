import './index.css';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { App } from './app';
import { AppServicesProvider } from './composition/app-services';
import { createAppServices, pendingBootSteps } from './composition/root';
import { BootFailure } from './shell/boot-failure';
import { BootShell } from './shell/boot-shell';

const container = requireRoot();

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
try {
  const services = await withTimeout(
    createAppServices(reportError),
    BOOT_TIMEOUT_MS
  );
  takeOver(
    <AppServicesProvider services={services}>
      <App />
    </AppServicesProvider>
  );
} catch (error) {
  console.error('the workbench failed to start', error);
  takeOver(<BootFailure error={error} />);
}
