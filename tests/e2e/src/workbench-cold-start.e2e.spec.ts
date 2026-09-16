import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, createServer } from 'vite';
import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import { rehostCookies } from './helpers/built-workbench.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

const appRoot = fileURLToPath(
  new URL('../../../apps/workbench/', import.meta.url)
);

/** Real app/config, but a NEW optimizer cache and loopback port for every case. */
async function serveColdWorkbench() {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'workbench-vite-'));
  const server = await createServer({
    root: appRoot,
    configFile: path.join(appRoot, 'vite.config.ts'),
    cacheDir,
    customLogger: createLogger('error'),
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      // Sign-in uses the normal gateway; subsequent session/API requests keep
      // using the real backend, just as in the built-workbench harness.
      proxy: {
        '^/(?!author(?:/|$))': {
          target: process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }).catch(async (error: unknown) => {
    await rm(cacheDir, { recursive: true, force: true });
    throw error;
  });
  const close = async () => {
    try {
      await server.close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  };
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing Vite port');
    return {
      origin: `http://127.0.0.1:${address.port}`,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

test('@full cold-start chat survives worker dependency loading without a page reload', async ({
  browser,
  page: gatewayPage,
  seededUser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  let served: Awaited<ReturnType<typeof serveColdWorkbench>> | undefined;
  let org:
    Awaited<ReturnType<typeof bootstrapOrgSpaceAdminForUser>> | undefined;
  try {
    served = await serveColdWorkbench();
    const origin = served.origin;
    org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    await loginViaUi(gatewayPage, seededUser, '/platform/profile');
    await context.addCookies(
      rehostCookies(await gatewayPage.context().cookies(), served.origin)
    );
    const page = await context.newPage();
    let hmrConnected = false;
    const workerDependencies = new Set<string>();
    context.on('requestfinished', (request) => {
      const name = new URL(request.url()).pathname.split('/').pop();
      if (name?.includes('transformers') || name?.includes('zip'))
        workerDependencies.add(name);
    });
    const reload = new Promise<void>((resolve) => {
      // Observe the real HMR channel. Do not intercept/suppress reloads: fail
      // promptly instead of waiting out a missing transcript after a reload.
      page.on('websocket', (socket) => {
        if (!new URL(socket.url()).pathname.endsWith('/__vite_hmr')) return;
        socket.on('framereceived', ({ payload }) => {
          const message = JSON.parse(payload.toString()) as { type: string };
          if (message.type === 'connected') hmrConnected = true;
          if (message.type === 'full-reload') resolve();
        });
      });
    });
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    await Promise.race([
      reload.then(() => {
        throw new Error(
          'Vite requested full-reload while opening or using the chat'
        );
      }),
      (async () => {
        await page.goto(`${origin}/author/`);
        await expect(page.getByTestId('workbench-ready')).toBeVisible({
          timeout: 120_000,
        });
        await page.getByTestId('chat-panel-trigger').click();
        const composer = page.getByTestId('chat-input');
        await expect(composer).toBeEnabled();
        await composer.fill('hello');
        await composer.press('Enter');
        await expect(page.getByTestId('chat-transcript')).toContainText(
          'Hello from the local model'
        );
        await expect(page.getByTestId('chat-send')).toBeVisible();
        expect(hmrConnected).toBe(true);
        await expect
          .poll(() =>
            [...workerDependencies].some((name) => name.includes('zip'))
          )
          .toBe(true);
        await expect
          .poll(() =>
            [...workerDependencies].some((name) =>
              name.includes('transformers')
            )
          )
          .toBe(true);
        expect(navigations).toBe(1);
        expect(
          await page.evaluate(() =>
            navigator.serviceWorker.getRegistrations().then((all) => all.length)
          )
        ).toBe(0);
      })(),
    ]);
  } finally {
    // Close browser writers before deleting server fixtures.
    try {
      await context.close();
      if (org) await deleteOrganizationCascade(org.organizationId);
    } finally {
      await served?.close();
    }
  }
});
