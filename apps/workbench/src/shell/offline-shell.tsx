import { createRoot } from 'react-dom/client';
import { UpdatePrompt } from './update-prompt';

/**
 * Installs the offline shell: the service worker that serves the app's own
 * files, so a reload with no network opens the editor instead of a browser
 * error page.
 *
 * The scope is the app's mount and nothing wider. Another app shares this
 * origin, and its requests — the session check most of all — must keep
 * reaching the network and failing honestly when there is none.
 *
 * The worker is a build artefact: in development there is none to install,
 * and a stale one from an earlier build of the same origin would serve
 * yesterday's files over today's dev server, so it is removed instead.
 */
const APPLY_UPDATE = { type: 'workbench-apply-update' } as const;

export function installOfflineShell(base: string): void {
  if (!('serviceWorker' in navigator)) return;

  // `DEV` is a Vite build-time constant, not an environment variable; the
  // lint rule that tracks env reads for cache invalidation cannot tell the
  // two apart.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (import.meta.env.DEV) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations
            .filter((registration) => registration.scope.endsWith(base))
            .map((registration) => registration.unregister())
        )
      )
      .catch((error: unknown) => {
        console.error('could not remove a stale offline shell', error);
      });
    return;
  }

  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base, type: 'classic' })
    .then((registration) => {
      watchForUpdate(registration);
    })
    .catch((error: unknown) => {
      // An app that cannot be stored offline is still a working app; the
      // failure belongs in the console, not in the user's way.
      console.error('the offline shell did not install', error);
    });
}

/**
 * A newer build takes over only when the user says so, and taking it over
 * means reloading the page: the local database is exclusive to one page,
 * so a new build cannot start using it while the old page still holds it.
 */
function watchForUpdate(registration: ServiceWorkerRegistration): void {
  // The very first install is not an update — there is nothing to replace,
  // and the page already has everything it needs.
  const firstInstall = !navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  const offer = (waiting: ServiceWorker) => {
    if (firstInstall) return;
    showUpdatePrompt(() => waiting.postMessage(APPLY_UPDATE));
  };

  if (registration.waiting) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && registration.waiting)
        offer(registration.waiting);
    });
  });
}

let prompt: HTMLElement | undefined;

function showUpdatePrompt(onApply: () => void): void {
  if (prompt) return;
  prompt = document.createElement('div');
  document.body.append(prompt);
  createRoot(prompt).render(<UpdatePrompt onApply={onApply} />);
}
