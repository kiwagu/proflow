/**
 * Open a headed Chromium (the Playwright-managed build) at the dev gateway.
 *
 * Uses a PERSISTENT profile, so cookies / the auth session (and saved
 * passwords) survive across runs — no need to log in every time. The context
 * uses `ignoreHTTPSErrors`, so the local TLS cert never blocks the page —
 * handy when your daily browser does not trust the mkcert / self-signed CA
 * (e.g. snap-confined Brave/Chromium that ignore the host NSS).
 *
 * Extensions: the automation build (Chrome for Testing) cannot install from
 * the Chrome Web Store. Side-load instead — drop an UNPACKED extension folder
 * (one with a manifest.json) under `tests/e2e/.dev-browser-extensions/<name>/`
 * and it is loaded automatically. Override the list with DEV_BROWSER_EXTENSIONS
 * (comma-separated paths to unpacked extension dirs).
 *
 * Usage:
 *   bun run dev:browser            # opens https://proflow.local/platform
 *   bun run dev:browser /author    # opens a specific path
 *   PLAYWRIGHT_BASE_URL=... bun run dev:browser
 *   DEV_BROWSER_PROFILE=/path bun run dev:browser      # override profile dir
 *   DEV_BROWSER_EXTENSIONS=/a,/b bun run dev:browser   # override extension dirs
 *
 * Close the window to exit. Delete the profile dir to start fresh.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, '..');

const profileDir =
  process.env.DEV_BROWSER_PROFILE ?? path.join(e2eRoot, '.dev-browser-profile');

// Collect unpacked extension dirs: explicit env override, else every subdir of
// `.dev-browser-extensions/` that contains a manifest.json.
function resolveExtensions(): string[] {
  if (process.env.DEV_BROWSER_EXTENSIONS) {
    return process.env.DEV_BROWSER_EXTENSIONS.split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  const dir = path.join(e2eRoot, '.dev-browser-extensions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name))
    .filter((p) => fs.existsSync(path.join(p, 'manifest.json')));
}

const extensions = resolveExtensions();
const extArgs =
  extensions.length > 0
    ? [
        `--disable-extensions-except=${extensions.join(',')}`,
        `--load-extension=${extensions.join(',')}`,
      ]
    : [];

const base = (
  process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local'
).replace(/\/$/, '');
const arg = process.argv[2] ?? '/platform';
const url = `${base}${arg.startsWith('/') ? arg : `/${arg}`}`;

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: false,
  ignoreHTTPSErrors: true,
  viewport: null,
  args: ['--start-maximized', ...extArgs],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
console.log(`Opened ${url} (profile: ${profileDir})`);
if (extensions.length > 0) {
  console.log(
    `Loaded ${extensions.length} extension(s): ${extensions.map((p) => path.basename(p)).join(', ')}`
  );
}
console.log('Close the window to exit.');

await new Promise<void>((resolve) => {
  context.on('close', () => resolve());
});
