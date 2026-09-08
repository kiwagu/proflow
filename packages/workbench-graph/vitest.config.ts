import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Real PGlite instances must fit within the worker's memory budget.
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    // The graph specs open a real PGlite per case (recursive CTEs, upserts on
    // natural keys) — slower than a mocked store and worth it, but past the
    // 5s default.
    testTimeout: 30_000,
  },
});
