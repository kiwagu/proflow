import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('./', import.meta.url));
const uiRoot = fileURLToPath(new URL('../../packages/ui/src/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': appRoot,
      '@workspace/ui': uiRoot,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
