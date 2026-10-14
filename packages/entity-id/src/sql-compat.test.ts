import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import { ENTITY_ID_SQL } from 'entity-id/sql';

import {
  ENTITY_PREFIXES,
  entityIdRegistry,
  isEntityId,
  parseEntityId,
  strictEntityIdSchema,
} from './index.js';

/**
 * The database and this package mint and check the same id contract. The
 * migration that installs the database side is pinned here two ways: it carries
 * the published package's functions verbatim (so a package upgrade that changes
 * them shows up as a failing test, not as drift), and the regular expression
 * its `is_entity_id` applies agrees with the package on ids minted on either
 * side. `supabase/tests/entity_id_compat.sql` checks the same samples from the
 * database's side.
 */

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/20261014130000_entity_id_validators.sql',
      import.meta.url
    )
  ),
  'utf8'
);

/** Every `create or replace function … $$;` statement of a SQL text. */
const functionStatements = (sql: string): string[] =>
  sql.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];

/** The pattern `public.is_entity_id` matches against, as a JS RegExp. */
const sqlIdPattern = (): RegExp => {
  const body =
    /function public\.is_entity_id\(value text\)[\s\S]*?value ~ '([^']+)'/.exec(
      migration
    )?.[1];
  if (!body) throw new Error('is_entity_id pattern not found in the migration');
  return new RegExp(body);
};

const FULL = { mode: 'full' } as const;

/** Minted by the generator the migration replaces, read from a dev database. */
const MINTED_BY_PREVIOUS_SQL_GENERATOR = [
  'spc_ng7eccdk2074dsvk.01m2ara9cm',
  'org_y57fe5d5v76fj3m8.01m2ara9ck',
  'knr_szkzqcp6a1ryxjf1.01m4v5xmza',
  'kne_dses4y8d25svc7wg.01m4x37jqn',
  'doc_j8dwbmkfzqz11rqp.01m4v5zm85',
] as const;

/** Minted by the package at a fixed time; the SQL probe checks the same three. */
const MINTED_BY_TS = [
  { id: 'spc_634t13df1xe89j6d.01k7g08h00', timeMs: 1760400000000 },
  { id: 'doc_mfwnxpatbzhbfrja.01k7h9ewkv', timeMs: 1760443200123 },
  { id: 'wrt_rzgdg9qzq677snqs.01hf7yat00', timeMs: 1700000000000 },
] as const;

const MALFORMED = [
  "usr_' OR 1=1--",
  `usr_${'a'.repeat(200)}`,
  'usr_abc.def',
  'usr_aaaaaaaaaaaaaaaa.aaaaaaaaai',
  'USR_aaaaaaaaaaaaaaaa.aaaaaaaaaa',
  'usr_aaaaaaaaaaaaaaaa.aaaaaaaaaa ',
  '',
];

describe('the server-side id functions', () => {
  test('carry the published package functions verbatim', () => {
    const published = functionStatements(ENTITY_ID_SQL);
    expect(published.length).toBeGreaterThanOrEqual(8);
    for (const statement of published) {
      expect(migration).toContain(statement);
    }
  });

  test('accept every id the package mints, for every registered kind', () => {
    const pattern = sqlIdPattern();
    for (const factory of Object.values(entityIdRegistry.factories)) {
      const id = String(factory.create());
      expect(pattern.test(id)).toBe(true);
      expect(
        pattern.test(`${id.slice(0, 4)}${id.slice(4).toUpperCase()}`)
      ).toBe(true);
    }
  });

  test('ids from the previous SQL generator pass the package at full depth', () => {
    const pattern = sqlIdPattern();
    for (const id of MINTED_BY_PREVIOUS_SQL_GENERATOR) {
      expect(pattern.test(id)).toBe(true);
      expect(isEntityId(id, FULL)).toBe(true);
      expect(String(strictEntityIdSchema.parse(id))).toBe(id);
      expect(entityIdRegistry.kindOf(id)).toBeDefined();
    }
  });

  test('the time suffix is the timestamp the package decodes', () => {
    for (const { id, timeMs } of MINTED_BY_TS) {
      const parsed = parseEntityId(id, FULL);
      expect(parsed.timeMs).toBe(timeMs);
      // `entity_id_ts_of` returns the text after the dot.
      expect(id.slice(id.indexOf('.') + 1)).toBe(parsed.ts);
    }
  });

  test('reject malformed values on both sides', () => {
    const pattern = sqlIdPattern();
    for (const value of MALFORMED) {
      expect(pattern.test(value)).toBe(false);
      expect(isEntityId(value, FULL)).toBe(false);
    }
  });

  test('the samples cover registered kinds only', () => {
    const registered = new Set<string>(Object.values(ENTITY_PREFIXES));
    for (const id of [
      ...MINTED_BY_PREVIOUS_SQL_GENERATOR,
      ...MINTED_BY_TS.map((s) => s.id),
    ]) {
      expect(registered.has(id.slice(0, id.indexOf('_')))).toBe(true);
    }
  });
});
