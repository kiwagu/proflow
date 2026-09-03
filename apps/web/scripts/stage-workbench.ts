/**
 * Stages the workbench's production build into this app's `public/` tree so
 * `next build` ships it as static files under the author mount.
 *
 * Runs before `next build` (see the `build` script). The source is the
 * workbench's `dist/`, which its own `build` produced with the same base
 * path; the destination directory name is the mount itself, which is what
 * makes `/author/index.html` resolve. The previous staging is removed first
 * so a renamed hashed chunk does not linger as a stale file.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { getGatewayAuthorPath } from '@workspace/gateway-auth/gateway-paths';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const source = path.resolve(webRoot, '../workbench/dist');
const mount = getGatewayAuthorPath().replace(/^\//, '');
const target = path.join(webRoot, 'public', mount);

const built = await stat(path.join(source, 'index.html')).catch(() => null);
if (!built) {
  console.error(
    `workbench build not found at ${source} — run its build first (turbo orders it before this app's).`
  );
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`staged workbench build → public/${mount}`);
