/**
 * Used by the root `dev:apps` script: runs `turbo dev` with optional package exclusions.
 * Default `bun run dev` runs `build:libs` first, then `dev:apps` (avoids `^build` on every app dev task).
 * Other root scripts (`build`, `lint`, etc.) call `turbo` directly.
 *
 * Usage (from repo root):
 *   bun run dev -- --exclude platform
 *   bun run dev:apps -- --exclude platform
 *   bun run dev -- --exclude platform,author
 *   bun run dev -- -x web -x author
 *
 * Excluded names must match workspace `package.json` `name` (e.g. web, platform, author,
 * @workspace/notifications-service).
 * Run excluded apps separately: cd apps/<name> && bun dev (uses that app's port).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

function parseExcludesAndRest(argv: string[]): {
  excludes: string[];
  rest: string[];
} {
  const excludes: string[] = [];
  const rest: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) {
      break;
    }

    if (a === '--') {
      rest.push(...argv.slice(i));
      break;
    }

    if (a === '--exclude' || a === '-x') {
      i += 1;
      while (i < argv.length) {
        const chunk = argv[i];
        if (chunk === undefined || chunk.startsWith('-')) {
          break;
        }
        excludes.push(
          ...chunk
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
        i += 1;
      }
      continue;
    }

    if (a.startsWith('--exclude=')) {
      const v = a.slice('--exclude='.length);
      excludes.push(
        ...v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      i += 1;
      continue;
    }

    rest.push(a);
    i += 1;
  }

  return { excludes, rest };
}

const argv = process.argv.slice(2);
const task = argv.shift();

if (!task || task.startsWith('-')) {
  console.error(
    'Usage: turbo-with-exclude.ts <task> [--exclude <pkg>[,<pkg>...] ...] [-x <pkg>] [-- <turbo args>]]'
  );
  process.exit(1);
}

const { excludes, rest } = parseExcludesAndRest(argv);
const filterArgs = excludes.map((name) => `--filter=!${name}`);
const turboArgs = [task, ...filterArgs, ...rest];

const binDir = path.join(process.cwd(), 'node_modules', '.bin');
const env = {
  ...process.env,
  PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
};

const result = spawnSync('turbo', turboArgs, {
  stdio: 'inherit',
  cwd: process.cwd(),
  env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
