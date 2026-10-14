import { describe, expect, test } from 'bun:test';

import {
  entityIdRegistry,
  entityIdSchemas,
  getValidationMode,
  isEntityId,
  normalizeEntityId,
  parseEntityId,
  canonicalEntityIdSchemaFor,
  strictEntityIdSchema,
  type ValidationMode,
  withValidationMode,
} from './index.js';

/**
 * Validation depth in the published package is a process-wide mode, and its
 * default (`mixed`) checks only the `<prefix>_` head. Nothing in the repo sets
 * the mode, so these pins run in a process that never does — and repeat the
 * strict checks inside every mode, because a regression that inherits the mode
 * only shows on the weaker ones.
 *
 * What a trust boundary may rely on whatever the mode: `strictEntityIdSchema`,
 * `canonicalEntityIdSchemaFor(kind)`, `normalizeEntityId`, and the imperative
 * guards with a per-call `{ mode: 'full' }`. What it may not: the per-kind
 * `entityIdSchemas.<kind>.schema` and the imperative guards without the
 * override — pinned below so a package upgrade that changes either shows up.
 */

const MODES: readonly ValidationMode[] = ['fast', 'mixed', 'full'];
const FULL = { mode: 'full' } as const;

const { userIdFactory, spaceIdFactory } = entityIdRegistry.factories;

const good = String(userIdFactory.create());
const upper = `usr_${good.slice(4).toUpperCase()}`;
const wrongKind = String(spaceIdFactory.create());

const MALFORMED: Readonly<Record<string, string>> = {
  injection: "usr_' OR 1=1--",
  overLong: `usr_${'a'.repeat(200)}`,
  splitDecodable: 'usr_abc.def',
  injectionWithDot: "usr_' OR 1=1--.x",
  badAlphabet: 'usr_aaaaaaaaaaaaaaaa.aaaaaaaaai',
  empty: '',
};

describe('what entity-id 1.2.0 does under its default mode', () => {
  test('the suite runs under the package default mode (nothing set it)', () => {
    expect(getValidationMode()).toBe('mixed');
  });

  test('the per-kind schema and the bare guards check only the prefix head', () => {
    const injection = MALFORMED.injection!;
    expect(entityIdSchemas.user.schema.safeParse(injection).success).toBe(true);
    expect(isEntityId(injection)).toBe(true);
    expect(userIdFactory.is(injection)).toBe(true);
    expect(String(userIdFactory.assert(upper))).toBe(upper);
    expect(parseEntityId(MALFORMED.splitDecodable!).rand).toBe('abc');
  });

  test('the prefix gate tolerates a placeholder suffix but not a wrong kind', () => {
    for (const mode of MODES) {
      withValidationMode(mode, () => {
        const gate = entityIdSchemas.knowledgeResource.prefixSchema;
        expect(gate.safeParse('knr_this_id_x').success).toBe(true);
        expect(gate.safeParse('spc_whatever').success).toBe(false);
        expect(gate.safeParse('').success).toBe(false);
      });
    }
  });
});

describe('the full-depth surface does not follow the mode', () => {
  for (const mode of MODES) {
    describe(`with the ambient mode at "${mode}"`, () => {
      const inMode = <T>(fn: () => T): T => withValidationMode(mode, fn);

      for (const [name, value] of Object.entries(MALFORMED)) {
        test(`rejects ${name}`, () => {
          inMode(() => {
            expect(strictEntityIdSchema.safeParse(value).success).toBe(false);
            expect(
              canonicalEntityIdSchemaFor('user').safeParse(value).success
            ).toBe(false);
            expect(isEntityId(value, FULL)).toBe(false);
            expect(userIdFactory.is(value, FULL)).toBe(false);
            expect(() => userIdFactory.assert(value, FULL)).toThrow();
            expect(() => parseEntityId(value, FULL)).toThrow();
            expect(() => normalizeEntityId(value)).toThrow();
          });
        });
      }

      test('rejects an id of the wrong kind in a kind-specific slot', () => {
        inMode(() => {
          expect(
            canonicalEntityIdSchemaFor('user').safeParse(wrongKind).success
          ).toBe(false);
          expect(userIdFactory.is(wrongKind, FULL)).toBe(false);
          expect(() => userIdFactory.assert(wrongKind, FULL)).toThrow();
        });
      });

      test('normalizes mixed case and padding to the canonical id', () => {
        inMode(() => {
          expect(String(strictEntityIdSchema.parse(` ${upper} `))).toBe(good);
          expect(String(userIdFactory.assert(upper, FULL))).toBe(good);
          expect(String(normalizeEntityId(upper))).toBe(good);
          const parsed = parseEntityId(upper, FULL);
          expect(`${parsed.prefix}_${parsed.rand}.${parsed.ts}`).toBe(good);
        });
      });

      test('takes a stored key only exactly as stored: canonical, never rewritten', () => {
        inMode(() => {
          const stored = canonicalEntityIdSchemaFor('user');
          expect(String(stored.parse(good))).toBe(good);
          // A key in another spelling is a different key: refused, not
          // lower-cased or trimmed into the one it resembles.
          expect(stored.safeParse(upper).success).toBe(false);
          expect(stored.safeParse(` ${good}`).success).toBe(false);
          expect(stored.safeParse(`${good}\n`).success).toBe(false);
        });
      });
    });
  }

  test('the ambient mode is untouched afterwards', () => {
    expect(getValidationMode()).toBe('mixed');
  });
});
