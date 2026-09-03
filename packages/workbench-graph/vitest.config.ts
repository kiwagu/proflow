import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    // The graph specs open a real PGlite per case (recursive CTEs, upserts on
    // natural keys) — slower than a mocked store and worth it, but past the
    // 5s default.
    testTimeout: 30_000,
  },
});
