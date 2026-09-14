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
  // One worker, always. A second Playwright worker does not buy parallelism here:
  // both workers drive the SAME shared dev stand (one Next dev server, one
  // Supabase), so they contend rather than scale. Under that contention a
  // sign-in that normally answers in ~2s outlives the 30s default test timeout
  // and whichever spec happens to be mid-`loginViaUi` dies — a different victim
  // each run, on any branch, in any order, which is exactly why this read as
  // "undeterministic" rather than as a broken spec.
  //
  // Measured on this stand, full suite, `--retries=0` both sides:
  //   2 workers: 3 failed / 24 passed (4.9m) — `Waiting for post-login redirect`
  //   1 worker:  0 such failures (7.5m); the only reds left are a pre-existing
  //              offline-shell defect unrelated to timing.
  // Serializing just the heavy workbench specs was measured and is NOT enough:
  // the platform-only subset at 2 workers still lost a spec to the same 30s
  // stall (1 of 2 runs). The contention is the shared stand, not one spec
  // family, so the cap belongs here rather than on a describe block.
  //
  // The cost is ~2.6m on a full run, not the 3x it first appears: runs that
  // looked like 13-15m were paying `retries: 2` on the offline-shell failures.
  // Raising per-test budgets would only move the deadline; removing the
  // contention removes the race.
  workers: 1,
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
