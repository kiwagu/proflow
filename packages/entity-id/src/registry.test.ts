import { describe, expect, test } from 'bun:test';

import {
  ALL_ENTITY_PREFIXES,
  assertEntityIdWithPrefix,
  brandedEntityIdSchema,
  createEntityIdFor,
  ENTITY_PREFIXES,
  entityIds,
  isEntityId,
  isEntityIdWithPrefix,
  isRegisteredPrefix,
  PREFIX_RE,
  prefixFor,
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

// The prefixes are static, so their invariants are asserted here (CI) instead
// of by a runtime guard on every boot.
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

  test('has a well-formed prefix for every kind', () => {
    for (const prefix of Object.values(ENTITY_PREFIXES)) {
      expect(prefix).toMatch(PREFIX_RE);
    }
  });

  test('ALL_ENTITY_PREFIXES is the sorted, complete set', () => {
    expect(ALL_ENTITY_PREFIXES).toEqual(
      [...new Set(Object.values(ENTITY_PREFIXES))].sort()
    );
  });

  test('prefixFor / isRegisteredPrefix agree with the catalog', () => {
    expect(prefixFor('body')).toBe('bod');
    expect(prefixFor('organization')).toBe('org');
    expect(isRegisteredPrefix('knr')).toBe(true);
    expect(isRegisteredPrefix('nope')).toBe(false);
  });

  test('createEntityIdFor mints a valid id under the registered prefix', () => {
    const id = createEntityIdFor('space');
    expect(isEntityId(id)).toBe(true);
    expect(id.startsWith('spc_')).toBe(true);
  });
});

describe('per-kind branded toolkit (entityIds)', () => {
  test('create mints an id under the kind prefix', () => {
    const id = entityIds.knowledgeResource.create();
    expect(isEntityId(id)).toBe(true);
    expect(id.startsWith('knr_')).toBe(true);
    expect(entityIds.knowledgeResource.prefix).toBe('knr');
  });

  test('is / assert accept the right prefix and reject others', () => {
    const spaceId = entityIds.space.create();
    expect(entityIds.space.is(spaceId)).toBe(true);
    expect(entityIds.user.is(spaceId)).toBe(false);

    expect(entityIds.space.assert(spaceId)).toBe(spaceId);
    expect(() => entityIds.user.assert(spaceId)).toThrow();
  });

  test('schema parses only its own kind', () => {
    const userId = entityIds.user.create();
    expect(entityIds.user.schema.parse(userId)).toBe(userId);
    expect(entityIds.body.schema.safeParse(userId).success).toBe(false);
  });

  test('prefixSchema gates the prefix but tolerates a non-canonical suffix', () => {
    // Correct prefix, fake suffix → accepted (fixtures / negative tests).
    expect(
      entityIds.knowledgeResource.prefixSchema.safeParse('knr_this_id_x')
        .success
    ).toBe(true);
    // Wrong KIND prefix → rejected at runtime (the swapped-id hazard).
    expect(entityIds.space.prefixSchema.safeParse('usr_whatever').success).toBe(
      false
    );
    // Missing prefix / empty → rejected.
    expect(entityIds.space.prefixSchema.safeParse('nope').success).toBe(false);
    expect(entityIds.space.prefixSchema.safeParse('').success).toBe(false);
    // A real id of the kind → accepted.
    expect(
      entityIds.space.prefixSchema.safeParse(entityIds.space.create()).success
    ).toBe(true);
  });

  test('looseSchema brands but only checks non-empty (placeholder ids pass)', () => {
    // A placeholder that is NOT a full entity-id still parses under looseSchema…
    expect(
      String(entityIds.knowledgeResource.looseSchema.parse('knr_placeholder'))
    ).toBe('knr_placeholder');
    // …but the strict schema rejects it.
    expect(
      entityIds.knowledgeResource.schema.safeParse('knr_placeholder').success
    ).toBe(false);
    // Empty string is still rejected by looseSchema.
    expect(entityIds.knowledgeResource.looseSchema.safeParse('').success).toBe(
      false
    );
  });

  test('every registered kind has a toolkit bound to its prefix', () => {
    for (const [kind, prefix] of Object.entries(ENTITY_PREFIXES)) {
      const kit = entityIds[kind as keyof typeof entityIds];
      expect(kit.prefix).toBe(prefix);
      expect(kit.is(kit.create())).toBe(true);
    }
  });
});

describe('branded prefix utilities', () => {
  test('brandedEntityIdSchema enforces the prefix', () => {
    const schema = brandedEntityIdSchema<'SpaceId'>('spc');
    const spaceId = entityIds.space.create();
    // Compare the underlying strings: the manual 'SpaceId' brand and the
    // toolkit's 'space' brand are intentionally different tags.
    expect(String(schema.parse(spaceId))).toBe(String(spaceId));
    expect(schema.safeParse(entityIds.user.create()).success).toBe(false);
  });

  test('isEntityIdWithPrefix / assertEntityIdWithPrefix are prefix-aware', () => {
    const orgId = entityIds.organization.create();
    expect(isEntityIdWithPrefix(orgId, 'org')).toBe(true);
    expect(isEntityIdWithPrefix(orgId, 'usr')).toBe(false);
    expect(assertEntityIdWithPrefix(orgId, 'org')).toBe(orgId);
    expect(() => assertEntityIdWithPrefix(orgId, 'usr')).toThrow();
  });
});
