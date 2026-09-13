import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin } from 'vite';

/**
 * Builds the offline shell alongside the app: the service worker and the
 * web app manifest.
 *
 * Both have to sit at the app's mount rather than among its hashed assets
 * — a worker's default scope is the directory it is served from, and this
 * one must cover the whole app without reaching the app beside it on the
 * same origin. So they are emitted at fixed names next to `index.html`,
 * after the main build, when the file list they describe finally exists.
 *
 * The worker is written as TypeScript and compiled here as its own tiny
 * bundle: it runs in a different global scope than the app and shares no
 * code with it, and its three build-time constants (the mount, a version,
 * the file list) are substituted at this point.
 */

export const SERVICE_WORKER_FILE = 'sw.js';
export const MANIFEST_FILE = 'manifest.webmanifest';

/**
 * Kept out of the install-time cache, with reasons:
 *
 * - the embedding runtime is over half the build and start-up never waits
 *   for it (it serves semantic search alone), so it is cached when a
 *   search first fetches it. Until then search is the one thing that
 *   needs a network — a deliberate, named degradation.
 * - source maps are a debugging artefact, not part of the app.
 */
const NOT_PRECACHED = [/(^|\/)ort-wasm-[^/]*\.wasm$/, /\.map$/];

async function filesUnder(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), {
    withFileTypes: true,
  });
  const found: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await filesUnder(root, relative)));
    else found.push(relative);
  }
  return found.sort();
}

export function offlineShell(options: {
  /** The app's mount, with a trailing slash. */
  base: string;
  /** Shown as the installed app's name. */
  name: string;
  shortName: string;
  description: string;
  themeColor: string;
  backgroundColor: string;
}): Plugin {
  const { base } = options;
  let root = process.cwd();
  let outDir = path.resolve(root, 'dist');
  return {
    name: 'workbench:offline-shell',
    apply: 'build',

    configResolved(config) {
      root = config.root;
      outDir = path.resolve(root, config.build.outDir);
    },

    // Resolved against the mount rather than the document: a deep link is
    // answered with the same page, and a relative href would then look
    // for these files beside that link instead of at the app's root.
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          attrs: { rel: 'manifest', href: `${base}${MANIFEST_FILE}` },
          injectTo: 'head' as const,
        },
      ];
    },

    async closeBundle() {
      await writeFile(
        path.join(outDir, MANIFEST_FILE),
        JSON.stringify(
          {
            name: options.name,
            short_name: options.shortName,
            description: options.description,
            // Both inside the mount: an installed window stays in this
            // app and hands anything else back to the browser.
            start_url: base,
            scope: base,
            display: 'standalone',
            theme_color: options.themeColor,
            background_color: options.backgroundColor,
            // No icons: the repository has none, and a placeholder would
            // be a worse answer than the platform's own default.
            icons: [],
          },
          null,
          2
        ) + '\n',
        'utf8'
      );

      const assets = (await filesUnder(path.join(outDir, 'assets'))).map(
        (name) => `assets/${name}`
      );
      const precache = ['index.html', MANIFEST_FILE, ...assets].filter(
        (name) => !NOT_PRECACHED.some((pattern) => pattern.test(name))
      );

      // The version is the file list itself: hashed asset names change
      // with their contents, and the page is hashed directly because its
      // name never changes. A build that emits the same files is the same
      // version and leaves an installed worker alone.
      const version = createHash('sha256');
      for (const name of precache) version.update(`${name}\n`);
      version.update(await readFile(path.join(outDir, 'index.html')));

      let bytes = 0;
      for (const name of precache)
        bytes += (await stat(path.join(outDir, name))).size;

      await build({
        configFile: false,
        logLevel: 'warn',
        define: {
          __SW_BASE__: JSON.stringify(base),
          __SW_VERSION__: JSON.stringify(version.digest('hex').slice(0, 16)),
          __SW_PRECACHE__: JSON.stringify(
            precache.map((name) => `${base}${name}`)
          ),
        },
        build: {
          outDir,
          emptyOutDir: false,
          target: 'esnext',
          // A classic script: service worker modules are still uneven
          // across browsers, and this bundle imports nothing anyway.
          lib: {
            entry: path.resolve(root, 'src/service-worker.ts'),
            formats: ['iife'],
            name: 'workbenchOfflineShell',
            fileName: () => SERVICE_WORKER_FILE,
          },
        },
      });

      console.log(
        `offline shell → ${SERVICE_WORKER_FILE}, ${MANIFEST_FILE}; precache ${precache.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`
      );
    },
  };
}
