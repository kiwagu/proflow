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
  // Cap at 2 workers in dev to avoid overloading the shared Next.js dev server,
  // which is single-threaded and causes auth/SSR timeouts under higher concurrency.
  workers: process.env.CI ? 1 : 2,
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
