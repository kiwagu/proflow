import { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { vector } from '@electric-sql/pglite-pgvector';
import { migrate } from '../db/migrate.js';
import type { AppDb } from '../db/db.js';

/**
 * A real PGlite instance with the app's own migrations applied — the graph
 * suite runs against actual Postgres, because what these queries are is
 * recursive CTEs, upserts on natural keys, gin/fts indexes and array
 * predicates. A mocked database would assert the strings, not the behaviour.
 *
 * pgvector is loaded because the migration set is applied whole and an
 * earlier migration creates the extension; the graph schema itself needs no
 * vectors.
 */
export async function openTestDb(): Promise<AppDb & { close: () => Promise<void> }> {
  const pg = await PGlite.create({ extensions: { live, vector } });
  await migrate(pg as unknown as Parameters<typeof migrate>[0]);
  return pg as unknown as AppDb & { close: () => Promise<void> };
}

let counter = 0;

/** Crockford base32, lowercase — the alphabet the id CHECK constraint accepts. */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

function encode(value: number, width: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < width; i++) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * A valid entity id of the given prefix. The schema CHECKs the shape
 * (`<prefix>_<rand16>.<ts10>` in lowercase Crockford base32), so a test row
 * has to carry a real one; the counter keeps them distinct and readable.
 */
export function testId(prefix: string): string {
  return `${prefix}_${encode(counter++, 16)}.${encode(Date.now(), 10)}`;
}

export const TEST_USER = '00000000-0000-4000-8000-000000000001';
export const OTHER_USER = '00000000-0000-4000-8000-000000000002';
