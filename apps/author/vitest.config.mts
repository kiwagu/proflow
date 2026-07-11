import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'tests/int/**/*.int.spec.{ts,tsx}',
      // Pure unit tests (no live stack) — domain/fan-out shape under a mocked db.
      'src/**/*.unit.test.{ts,tsx}',
    ],
  },
})
