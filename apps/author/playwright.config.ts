import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config';

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3002/author';
const webServerURL =
  process.env.PLAYWRIGHT_WEB_SERVER_URL ?? 'http://localhost:3002/author';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: {
    command: 'bun run dev',
    reuseExistingServer: true,
    url: webServerURL,
    env: {
      ...process.env,
      // e2e seeds Payload cookies only; skip Supabase admin redirect in proxy.
      AUTHOR_E2E_BYPASS_SUPABASE_PROXY: '1',
    },
  },
});
