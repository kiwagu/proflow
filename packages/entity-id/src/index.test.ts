import { describe, expect, test } from 'bun:test';

import {
  compareEntityIds,
  createEntityId,
  derivePrefixFromSlug,
  entityIdToIso,
  entityIdToTimeMs,
  entityIdToTuple,
  entityIdTsToTimeMs,
  entityIdWithPrefixSchema,
  ensureUniquePrefix,
  fromUlid,
  isEntityId,
  normalizeEntityId,
  parseEntityId,
  toUlid,
} from './index.js';

describe('@workspace/entity-id', () => {
  test('createEntityId returns <prefix>_<rand16>.<ts10> in lowercase', () => {
    const id = createEntityId('usr');
    expect(isEntityId(id)).toBe(true);
    // ULID Crockford base32 (lowercase): 0-9 a-h j k m n p q r s t v w x y z
    expect(id).toMatch(/^usr_[0-9a-hjkmnp-tv-z]{16}\.[0-9a-hjkmnp-tv-z]{10}$/);
    expect(String(id)).toBe(String(id).toLowerCase());
  });

  test('parseEntityId round-trips normalizeEntityId (mixed-case input allowed)', () => {
    const raw = 'usr_3C2G8H3A4K9P7X1N.01JQ8Z0M5V';
    const normalized = normalizeEntityId(raw);
    expect(String(normalized)).toBe('usr_3c2g8h3a4k9p7x1n.01jq8z0m5v');

    const parsed = parseEntityId(raw);
    expect(parsed.prefix).toBe('usr');
    expect(parsed.rand).toBe('3c2g8h3a4k9p7x1n');
    expect(parsed.ts).toBe('01jq8z0m5v');
    expect(parsed.ulid).toBe('01JQ8Z0M5V3C2G8H3A4K9P7X1N');
    expect(parsed.timeMs).toBeGreaterThan(0);
  });

  test('fromUlid/toUlid are inverses (canonical ULID is uppercase)', () => {
    const ulid = '01JQ8Z0M5V3C2G8H3A4K9P7X1N';
    const id = fromUlid('tnt', ulid);
    expect(String(id)).toBe('tnt_3c2g8h3a4k9p7x1n.01jq8z0m5v');
    expect(toUlid(id)).toBe(ulid);
  });

  test('compareEntityIds(mode=time) orders by embedded time then ULID randomness', () => {
    const a = 'usr_aaaaaaaaaaaaaaaa.01jq8z0m5v';
    const b = 'usr_bbbbbbbbbbbbbbbb.01jq8z0m5w';
    expect(compareEntityIds(a, b, 'time')).toBeLessThan(0);
    expect(compareEntityIds(b, a, 'time')).toBeGreaterThan(0);
  });

  test('derivePrefixFromSlug produces a normalized prefix', () => {
    expect(derivePrefixFromSlug('users')).toMatch(/^[a-z][a-z0-9]{1,15}$/);
    expect(derivePrefixFromSlug('users')).toBe(
      derivePrefixFromSlug('users').toLowerCase()
    );
  });

  test('ensureUniquePrefix avoids collisions in a used set', () => {
    const used = new Set<string>(['usr', 'user', 'usrs']);
    const a = ensureUniquePrefix('usr', 'users', used, { maxLen: 10 });
    used.add(a);
    const b = ensureUniquePrefix('usr', 'users', used, { maxLen: 10 });
    expect(a).not.toBe('usr');
    expect(b).not.toBe('usr');
    expect(a).not.toBe(b);
  });

  test('entityIdWithPrefixSchema validates required prefix', () => {
    const ok = entityIdWithPrefixSchema('usr').safeParse(
      'usr_3c2g8h3a4k9p7x1n.01jq8z0m5v'
    );
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(String(ok.data)).toBe('usr_3c2g8h3a4k9p7x1n.01jq8z0m5v');
    }

    const wrong = entityIdWithPrefixSchema('usr').safeParse(
      'tnt_3c2g8h3a4k9p7x1n.01jq8z0m5v'
    );
    expect(wrong.success).toBe(false);
  });

  test('entityIdToTuple returns prefix, rand, iso, timeMs', () => {
    const [prefix, rand, iso, timeMs] = entityIdToTuple(
      'usr_3c2g8h3a4k9p7x1n.01jq8z0m5v'
    );
    expect(prefix).toBe('usr');
    expect(rand).toBe('3c2g8h3a4k9p7x1n');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isFinite(timeMs)).toBe(true);
    expect(new Date(timeMs).toISOString()).toBe(iso);
  });

  test('entityIdToTimeMs/entityIdToIso extract timestamp', () => {
    const id = 'usr_3c2g8h3a4k9p7x1n.01jq8z0m5v';
    const ms = entityIdToTimeMs(id);
    expect(ms).toBeGreaterThan(0);
    expect(entityIdToIso(id)).toBe(new Date(ms).toISOString());
  });

  test('entityIdTsToTimeMs decodes ts segment directly', () => {
    const id = 'usr_3c2g8h3a4k9p7x1n.01jq8z0m5v';
    const parsed = parseEntityId(id);
    expect(entityIdTsToTimeMs(parsed.ts)).toBe(parsed.timeMs);
  });
});
