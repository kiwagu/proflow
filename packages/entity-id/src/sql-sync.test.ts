import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { ENTITY_PREFIXES, isRegisteredPrefix } from './index.js';

/**
 * Keep the DB and the TS registry from drifting: every prefix minted in a
 * migration via `entity_id_generate('<prefix>')` MUST be declared in
 * {@link ENTITY_PREFIXES}. This is what stops a new table shipping with a fresh
 * prefix that nobody registered — the exact door through which a duplicate
 * (`program`/`project` → `pr…`) would otherwise sneak in.
 *
 * The migrations live at the repo root, outside this package; resolve them
 * relative to this file and skip cleanly if they are absent (isolated builds).
 */
const migrationsDir = fileURLToPath(
  new URL('../../../supabase/migrations', import.meta.url)
);

const GENERATE_CALL = /entity_id_generate\('([a-z][a-z0-9]{1,15})'\)/g;

/** Every distinct prefix minted across all migrations, with the file it came from. */
function sqlPrefixes(): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(migrationsDir)) return found;
  for (const file of readdirSync(migrationsDir)) {
    if (!file.endsWith('.sql')) continue;
    const sql = readFileSync(`${migrationsDir}/${file}`, 'utf8');
    for (const match of sql.matchAll(GENERATE_CALL)) {
      const prefix = match[1];
      if (prefix && !found.has(prefix)) found.set(prefix, file);
    }
  }
  return found;
}

describe('TS registry ↔ SQL migrations sync', () => {
  const prefixes = sqlPrefixes();

  test('migrations directory was found (guard against a silent no-op)', () => {
    expect(existsSync(migrationsDir)).toBe(true);
    expect(prefixes.size).toBeGreaterThan(0);
  });

  test('every prefix minted in SQL is registered in ENTITY_PREFIXES', () => {
    const unregistered = [...prefixes.entries()]
      .filter(([prefix]) => !isRegisteredPrefix(prefix))
      .map(([prefix, file]) => `${prefix} (first in ${file})`)
      .sort();
    // On failure this NAMES the offending prefix + migration, e.g.
    // ["prg (first in 20260701_programs.sql)"] — add it to the registry.
    expect(unregistered).toEqual([]);
  });

  test('the sync check would catch an unregistered SQL prefix', () => {
    // Sanity: proves the assertion above has teeth.
    expect(isRegisteredPrefix('zzq')).toBe(false);
    expect(Object.values(ENTITY_PREFIXES)).toContain('knr');
  });
});
