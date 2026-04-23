import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const entry = path.join(pkgRoot, 'src/deno-bundle.ts');
const outfile = path.resolve(
  pkgRoot,
  '../../infra/dev/supabase/volumes/functions/_shared/notifications.bundle.mjs'
);

await esbuild.build({
  absWorkingDir: pkgRoot,
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile,
  jsx: 'automatic',
  logLevel: 'info',
});
