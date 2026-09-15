import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

export default defineConfig({
  testDir: './src',
  testMatch: '*.e2e.spec.ts',
  globalSetup: './src/global-setup.ts',
  globalTeardown: './src/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Per-test budget. Playwright's own default is 30s, and that default was
  // what half the suite silently ran on: the workbench specs raise it to
  // 120-300s themselves, while every auth/platform spec kept the 30s one.
  //
  // 30s is not a measurement of anything — a platform spec spends it on a
  // login, a navigation, a form and a server round-trip, so the margin left
  // over is whatever the machine happens to grant that run. Measured here as
  // the suite got denser (one more file packs the two workers tighter, 27
  // tests in 2.2m vs 28 in 2.2m): the victims were `platform-super-admin`
  // (create-role button still disabled when its 30s ran out), then
  // `workbench-history`, then `auth-session` — a different one each run,
  // which is the signature of a budget that is too tight rather than of a
  // product defect.
  //
  // A timeout is a CEILING, not a pause: raising it costs a green run
  // nothing and only changes how long a genuinely stuck test waits before
  // it is called stuck. 120s matches what the workbench specs already
  // chose for themselves, so the suite now has ONE budget instead of two.
  timeout: 120_000,
  // Two workers. This is a measured ceiling, not a preference.
  //
  // The single worker that used to stand here was set against contention that
  // turned out not to be contention at all: the gateway recycled an HTTP/2
  // connection in the middle of a page load, so whichever spec happened to be
  // mid-`loginViaUi` died. With that fixed at the edge, two workers are stable.
  //
  // Measured on this stand, full suite, `--retries=0`, three runs each:
  //   1 worker:  225 / 221 / 218s — 27/27 every run
  //   2 workers: 131 / 131 / 130s — 27/27 every run
  //   3 workers: 124 / 129 / 124s — 26/27 on one run (the super-admin role
  //              catalog spec asserts on a list it shares with its siblings)
  // Three buys ~5s and costs a red, so the cap is two.
  //
  // `fullyParallel` was measured too and is deliberately OFF: splitting files
  // across workers made the suite SLOWER (136 / 141 / 136s), because the two
  // long workbench specs land in the same file and are then serialized behind
  // each other while the other worker idles. File-level scheduling packs them
  // better.
  //
  // What does NOT move this number, also measured, so it is not re-litigated:
  // signing in through the form costs 665ms against 628ms for an API session
  // handed to the browser as a cookie — 34 logins are ~1.4s of a 221s suite.
  // Seeding and deleting a user is 73ms + 33ms. The floor is one spec:
  // `workbench-history` takes 72s waiting out the editor's own 30s version
  // interval three times, and no test infrastructure can shorten a product
  // timer.
  workers: 2,
  reporter: 'html',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
});
