import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  rehostCookies,
  serveBuiltWorkbench,
  type BuiltWorkbenchOrigin,
} from './helpers/built-workbench.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';
import type { SeededUser } from './helpers/test-user.js';

/**
 * The app promises its documents live on the device. These cases hold it
 * to that across a RELOAD, which is where the promise used to break: with
 * no service worker the browser asks the network for every asset and gets
 * nothing back.
 *
 * They run against the PRODUCTION build on its own loopback origin, since
 * the dev server ships no service worker and the behaviour under test does
 * not exist there. Everything outside the app's own mount is proxied to
 * the same gateway the rest of the suite uses, so the session check is the
 * real one.
 */
test.describe('Workbench offline shell', () => {
  test.describe.configure({ timeout: 300_000 });

  let served: BuiltWorkbenchOrigin;

  test.beforeAll(async () => {
    served = await serveBuiltWorkbench();
  });

  test.afterAll(async () => {
    await served.close();
  });

  test('@full the editor opens after an offline reload, on the entry path and a nested one', async ({
    browser,
    seededUser,
  }) => {
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const { context, page } = await openBuiltWorkbench(browser, seededUser);
    try {
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });

      // The shell installs asynchronously; a reload only means anything
      // once a worker is actually controlling the page.
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
        undefined,
        { timeout: 60_000 }
      );

      const scope = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.scope;
      });
      expect(new URL(scope).pathname).toBe('/author/');

      // What is actually stored: the shell, with the embedding runtime
      // deliberately left out — nothing waits for it to open the editor.
      const cached = await shellCacheContents(page);
      expect(cached).not.toBeNull();
      expect(cached).toContain(`${served.origin}/author/index.html`);
      expect(
        cached?.filter((url) => /ort-wasm-[^/]*\.wasm$/.test(url))
      ).toEqual([]);
      expect(cached?.filter((url) => url.endsWith('.map'))).toEqual([]);

      await page.getByTestId('new-document').click();
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible();
      await editor.click();
      await editor.pressSequentially('Offline reload document');
      await expect(page.getByTestId('save-state')).toContainText(/saved/i);

      await context.setOffline(true);
      await page.reload();

      // The whole point: with no network at all, the app still opens and
      // the document is still there.
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await expect(
        page.getByText('Offline. Changes are saved on this device.')
      ).toBeVisible({ timeout: 60_000 });
      await page
        .getByTestId('files-section')
        .getByTestId('file-row')
        .first()
        .click();
      await expect(
        page.locator('[contenteditable="true"]').first()
      ).toContainText('Offline reload document');

      // The other app on this origin is untouched: its session check has
      // to keep reaching the network and failing honestly, which is what
      // the offline banner above already stands on.
      const session = await page.evaluate(() =>
        fetch('/platform/api/workbench/session').then(
          () => 'answered',
          () => 'failed'
        )
      );
      expect(session).toBe('failed');

      // A nested path is a client-side route: offline it must still be
      // answered with the app's page, not a 404.
      await page.goto('/author/does/not/exist/on/disk');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });

      await context.setOffline(false);
    } finally {
      await context.close();
      await deleteOrganizationCascade(org.organizationId);
    }
  });

  test('@full activating a new shell drops the previous generation of caches', async ({
    browser,
    seededUser,
  }) => {
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const { context, page } = await openBuiltWorkbench(browser, seededUser);
    try {
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
        undefined,
        { timeout: 60_000 }
      );

      // A previous build's caches, as they would be left on the device.
      // Each generation is tens of megabytes, so two must never coexist.
      await page.evaluate(async () => {
        const stale = await caches.open('workbench-shell-0000000000000000');
        await stale.put(
          '/author/index.html',
          new Response('<!doctype html><title>old</title>')
        );
        await caches.open('workbench-runtime-0000000000000000');
      });
      expect(await cacheNames(page)).toContain(
        'workbench-shell-0000000000000000'
      );

      // Activation is what sweeps them. Unregistering and reloading makes
      // the current shell install and activate again, exactly as a new
      // build's would.
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        await registration.unregister();
      });
      await page.reload();
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
        undefined,
        { timeout: 60_000 }
      );

      const names = await cacheNames(page);
      expect(names).not.toContain('workbench-shell-0000000000000000');
      expect(names).not.toContain('workbench-runtime-0000000000000000');
      expect(
        names.filter((name) => name.startsWith('workbench-shell-'))
      ).toHaveLength(1);
    } finally {
      await context.close();
      await deleteOrganizationCascade(org.organizationId);
    }
  });

  /**
   * Signs in on the gateway, then opens the built app with that session.
   *
   * The sign-in cannot happen on the harness origin: the gateway's dev
   * server only hydrates its React app for the hostnames it was configured
   * with, so its login form would never run there. The session is a
   * cookie, so it is carried across and the built app is exercised with a
   * real one.
   */
  async function openBuiltWorkbench(
    browser: { newContext: (options: object) => Promise<BrowserContext> },
    user: SeededUser
  ): Promise<{ context: BrowserContext; page: Page }> {
    const gateway = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      await loginViaUi(await gateway.newPage(), user, '/platform/profile');
      const context = await browser.newContext({
        baseURL: served.origin,
        ignoreHTTPSErrors: true,
      });
      await context.addCookies(
        rehostCookies(await gateway.cookies(), served.origin)
      );
      const page = await context.newPage();
      await page.goto('/author/');
      return { context, page };
    } finally {
      await gateway.close();
    }
  }
});

async function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

async function shellCacheContents(page: Page): Promise<string[] | null> {
  return page.evaluate(async () => {
    const shell = (await caches.keys()).find((name) =>
      name.startsWith('workbench-shell-')
    );
    if (!shell) return null;
    const cache = await caches.open(shell);
    return (await cache.keys()).map((request) => request.url);
  });
}
