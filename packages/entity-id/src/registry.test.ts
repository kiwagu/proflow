import { describe, expect, test } from 'bun:test';

import {
  defineEntityPrefixes,
  ENTITY_PREFIXES,
  entityIdRegistry,
  entityIdSchemas,
  isEntityId,
  PREFIX_RE,
} from './index.js';

/**
 * Lists every prefix claimed by more than one kind, as `"<prefix>: a + b"`.
 * Empty means no collision. On failure this NAMES the offenders instead of
 * failing on an opaque count — the whole reason the registry is static.
 */
const prefixCollisions = (
  catalog: Readonly<Record<string, string>>
): string[] => {
  const kindsByPrefix = new Map<string, string[]>();
  for (const [kind, prefix] of Object.entries(catalog)) {
    kindsByPrefix.set(prefix, [...(kindsByPrefix.get(prefix) ?? []), kind]);
  }
  return [...kindsByPrefix.entries()]
    .filter(([, kinds]) => kinds.length > 1)
    .map(([prefix, kinds]) => `${prefix}: ${kinds.sort().join(' + ')}`)
    .sort();
};

// The prefixes are static, so their invariants are asserted here (CI) as well
// as by the package when the registry is defined.
describe('ENTITY_PREFIXES catalog', () => {
  test('has no two kinds sharing a prefix', () => {
    // On failure this reads e.g. ["pr: program + project"] — the exact clash.
    expect(prefixCollisions(ENTITY_PREFIXES)).toEqual([]);
  });

  test('the collision check catches a duplicate (the pr_ hazard)', () => {
    // Proves the guard actually fires: two kinds compressing to the same `pr`.
    expect(
      prefixCollisions({ program: 'pr', project: 'pr', space: 'spc' })
    ).toEqual(['pr: program + project']);
  });

  test('the published registry refuses a colliding catalog at definition', () => {
    expect(() =>
      defineEntityPrefixes({ program: 'pr', project: 'pr' } as const)
    ).toThrow();
  });

  test('has a well-formed prefix for every kind', () => {
    for (const prefix of Object.values(ENTITY_PREFIXES)) {
      expect(prefix).toMatch(PREFIX_RE);
    }
  });

  test('is the catalog the registry was defined from', () => {
    expect(entityIdRegistry.prefixes).toBe(ENTITY_PREFIXES);
    expect(entityIdRegistry.kinds as readonly string[]).toEqual(
      Object.keys(ENTITY_PREFIXES)
    );
    expect(entityIdRegistry.allPrefixes).toEqual(
      [...new Set(Object.values(ENTITY_PREFIXES))].sort()
    );
  });

  test('routes a prefix and an id back to their kind', () => {
    expect(entityIdRegistry.prefixFor('body')).toBe('bod');
    expect(entityIdRegistry.isRegisteredPrefix('knr')).toBe(true);
    expect(entityIdRegistry.isRegisteredPrefix('nope')).toBe(false);
    expect(entityIdRegistry.kindForPrefix('wrt')).toBe('writer');
    expect(
      entityIdRegistry.kindOf(
        entityIdRegistry.factories.writerIdFactory.create()
      )
    ).toBe('writer');
  });
});

describe('one factory and one schema set per kind', () => {
  test('every registered kind mints a valid id under its own prefix', () => {
    for (const [kind, prefix] of Object.entries(ENTITY_PREFIXES)) {
      const factory = (
        entityIdRegistry.factories as unknown as Record<
          string,
          { prefix: string; create: () => string; is: (v: string) => boolean }
        >
      )[`${kind}IdFactory`];
      expect(factory?.prefix).toBe(prefix);
      const id = factory!.create();
      expect(isEntityId(id, { mode: 'full' })).toBe(true);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(factory!.is(id)).toBe(true);
    }
  });

  test('every registered kind has a prefix gate', () => {
    for (const kind of Object.keys(ENTITY_PREFIXES)) {
      expect(
        entityIdSchemas[kind as keyof typeof entityIdSchemas].prefixSchema
      ).toBeDefined();
    }
  });
});
