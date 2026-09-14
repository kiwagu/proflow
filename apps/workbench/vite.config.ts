import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import { offlineShell } from './offline-shell.plugin';

/**
 * Restores bare query flags on dev requests that came through the gateway.
 *
 * Vite's own module URLs carry valueless flags (`file.sql?raw&import`) and
 * its loaders match on exactly that form. A proxy that parses and re-emits
 * the query hands them back as `?raw=&import=`, which Vite no longer
 * recognises — the module then fails to transform. Dropping the empty `=`
 * is loss-free: an empty value and no value mean the same thing to Vite.
 */
function bareQueryFlags(): Plugin {
  return {
    name: 'workbench:bare-query-flags',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const at = req.url?.indexOf('?') ?? -1;
        if (req.url && at >= 0) {
          const path = req.url.slice(0, at);
          const query = req.url.slice(at).replace(/=(?=&|$)/g, '');
          req.url = path + query;
        }
        next();
      });
    },
  };
}

/**
 * The workbench is mounted under a path prefix on the gateway (default
 * `/author/`). Every asset URL the build emits and every route the dev server
 * answers is relative to that base, so the same bundle works behind the
 * gateway and stand-alone on its own port. The value must stay aligned with
 * the gateway's author mount (`NEXT_PUBLIC_GATEWAY_AUTHOR_PATH`).
 */
const BASE_PATH = normalizeBase(process.env.WORKBENCH_BASE_PATH ?? '/author');

/**
 * The port the gateway's workbench upstream points at (`WORKBENCH_DEV_PORT` on
 * the gateway side); the two must agree for `/author/*` to reach this app.
 */
const DEV_PORT = Number(process.env.WORKBENCH_DEV_PORT ?? 3002);

function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '/';
  return `${trimmed.startsWith('/') ? '' : '/'}${trimmed}/`;
}

// Vite runs on Node (`bun run dev` executes the vite binary under its own
// node shebang). Never switch to `bunx --bun vite`: Bun's ws/http gaps break
// HMR and can kill the dev server silently.
export default defineConfig({
  define: {
    'import.meta.env.VITE_PLATFORM_BASE_PATH': JSON.stringify(
      process.env.NEXT_PUBLIC_GATEWAY_PLATFORM_PATH ?? '/platform'
    ),
  },
  base: BASE_PATH,
  plugins: [
    bareQueryFlags(),
    react(),
    tailwind(),
    // The CRDT ships as WebAssembly and imports it as an ES module, which
    // Vite does not resolve on its own.
    wasm(),
    // Build only: emits the service worker and the web app manifest at
    // the mount, after the file list they describe exists.
    offlineShell({
      base: BASE_PATH,
      name: 'ProFlow Workbench',
      shortName: 'Workbench',
      description:
        'Local-first documents, files and knowledge — everything stays on your device.',
      themeColor: '#ffffff',
      backgroundColor: '#ffffff',
    }),
  ],
  // The gateway (apps/web) proxies the mount prefix here in development and
  // forwards the browser's Host; Vite refuses any Host it was not told about,
  // and this is a local dev server whose exposure is the gateway's business.
  server: {
    // The gateway reaches this server at the IPv4 loopback (its upstream
    // host default); binding to `localhost` alone can land on `::1` only,
    // which the gateway would report as "not running". `--host` overrides
    // for LAN or tunnel exposure.
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
    allowedHosts: true,
    // Assets and HMR are served under the base too, so the gateway's single
    // prefix rewrite covers everything the page asks for.
    hmr: { path: `${BASE_PATH}__vite_hmr` },
  },
  preview: { port: DEV_PORT, strictPort: true },
  build: {
    target: 'esnext',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // The syntax highlighter's grammars are CommonJS files that reach
        // for a `Prism` global its core sets up, without requiring it — so
        // the bundler sees no edge between them and is free to run the
        // grammars first, which throws `Prism is not defined` before the
        // app's first render. Declaration order is the only thing that
        // expresses that dependency, so the output has to honour it.
        strictExecutionOrder: true,
      },
    },
  },
  // ES-format workers are required by the database and embedding workers.
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  // PGlite must not be pre-bundled: its worker + WASM asset resolution relies
  // on import.meta.url staying intact.
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector'],
    // Dependency pre-bundling has its own target, and it defaults to browsers
    // old enough to reject top-level await — which is how the CRDT's WASM
    // loader initialises itself. `build.target` does not cover this step.
    esbuildOptions: { target: 'esnext' },
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'lexical'],
    // The CRDT's package exports send production browser builds to its
    // sync-XMLHttpRequest loader (`browser/`), which blocks the main thread
    // and bypasses any service worker. The `bundler/` build (what dev mode
    // already resolves to) initialises the same WASM through an async fetch.
    alias: [{ find: /^loro-crdt$/, replacement: 'loro-crdt/bundler' }],
  },
});
