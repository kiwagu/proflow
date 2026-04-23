import {
  decodeTime as decodeUlidTime,
  monotonicFactory,
  ulid as ulidCanonical,
} from 'ulid';
import { z } from 'zod';

export type EntityId = string & z.BRAND<'EntityId'>;

/**
 * Zod schema for runtime validation + normalization.
 *
 * - accepts mixed-case input
 * - trims
 * - normalizes to canonical lowercase format
 * - brands the result as `EntityId`
 */
export const entityIdSchema = z
  .string()
  .transform((s) => s.trim())
  .superRefine((value: string, ctx: z.RefinementCtx) => {
    if (!value) {
      ctx.addIssue({
        code: 'custom',
        message: 'Entity id must not be empty',
      });
      return;
    }
    if (!ENTITY_ID_RE.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Invalid entity id. Expected "<prefix>_<rand16>.<ts10>" with ULID Crockford base32.',
      });
    }
  })
  .transform((value: string) => normalizeEntityId(value))
  .brand<'EntityId'>();

export type EntityIdParts = Readonly<{
  prefix: string;
  rand: string; // 16 chars, Crockford base32, lowercase
  ts: string; // 10 chars, Crockford base32, lowercase
}>;

export type ParsedEntityId = Readonly<
  EntityIdParts & {
    ulid: string; // 26 chars canonical ULID = ts + rand
    timeMs: number;
  }
>;

const CROCKFORD_BASE32 = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]+$/;
const PREFIX_RE = /^[a-z][a-z0-9]{1,15}$/;
const TS_RE = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{10}$/;

const ENTITY_ID_RE =
  /^(?<prefix>[a-z][a-z0-9]{1,15})_(?<rand>[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{16})\.(?<ts>[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{10})$/;

const ulidMonotonic = monotonicFactory();

function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}

function requiredGroup(
  groups: Record<string, string> | undefined,
  key: string
): string {
  const value = groups?.[key];
  if (!value) {
    throw new Error(`Invalid entity id: missing group "${key}".`);
  }
  return value;
}

export function normalizePrefix(prefix: string): string {
  const p = prefix.trim().toLowerCase();
  if (!PREFIX_RE.test(p)) {
    throw new Error(
      `Invalid entity prefix "${prefix}". Expected ${PREFIX_RE.source}.`
    );
  }
  return p;
}

/**
 * Derive a short, readable prefix from a collection/entity slug.
 *
 * - Start with the first slug character.
 * - Remove vowels from the rest.
 * - Split by non-letters into words.
 * - Remove trailing plural 's' per word.
 * - Take first 4 chars per word.
 * - Collapse doubled letters.
 * - Truncate to maxLen.
 * - Enforce minLen by falling back to slug.slice(0, minLen).
 *
 * Result is normalized with `normalizePrefix` constraints (lowercase, starts with a letter).
 */
export function derivePrefixFromSlug(
  slug: string,
  options: Readonly<{
    minLen?: number;
    maxLen?: number;
  }> = {}
): string {
  const minLen = options.minLen ?? 3;
  const maxLen = options.maxLen ?? 10;

  const raw = String(slug ?? '').trim();
  if (raw.length === 0) {
    throw new Error('Cannot derive prefix from empty slug.');
  }

  const first = raw[0] ?? '';
  const rest = raw
    .slice(1)
    .replace(/[aeiou]/gi, '')
    .split(/[^a-zA-Z]+/)
    .map((word) => word.replace(/s$/i, ''))
    .map((word) => word.slice(0, 4))
    .join('');

  let basePrefix = `${first}${rest}`
    .replace(/([a-zA-Z])\1+/g, '$1')
    .slice(0, maxLen)
    .toLowerCase();

  if (basePrefix.length < minLen) {
    basePrefix = raw.slice(0, minLen).toLowerCase();
  }

  // Ensure it starts with a letter; if not, prefix with 'x' and trim.
  if (!/^[a-z]/.test(basePrefix)) {
    basePrefix = `x${basePrefix}`.slice(0, maxLen);
  }

  // Final contract enforcement (length + chars).
  return normalizePrefix(basePrefix.slice(0, Math.max(minLen, 2)));
}

/**
 * Ensure a prefix is unique within a given set by appending extra slug chars or an index.
 * Returns a normalized prefix (lowercase).
 */
export function ensureUniquePrefix(
  basePrefix: string,
  slug: string,
  usedPrefixes: Set<string>,
  options: Readonly<{ maxLen?: number }> = {}
): string {
  const maxLen = options.maxLen ?? 10;
  const normalizedBase = normalizePrefix(basePrefix).slice(0, maxLen);

  let prefix = normalizedBase;
  let i = 1;

  while (usedPrefixes.has(prefix)) {
    const extra = slug[i] ? slug[i] : String(i);
    const candidate = `${normalizedBase}${extra}`.slice(0, maxLen);
    // candidate might violate prefix rules if extra is not [a-z0-9]; filter.
    prefix = candidate.replace(/[^a-z0-9]/g, '').slice(0, maxLen);
    prefix = prefix.length === 0 ? normalizedBase : prefix;
    prefix = normalizePrefix(prefix);
    i++;
  }

  return prefix;
}

export function ulidToEntityIdParts(
  ulid: string
): Omit<EntityIdParts, 'prefix'> {
  if (ulid.length !== 26) {
    throw new Error(`Invalid ULID length. Expected 26, got ${ulid.length}.`);
  }
  const u = ulid.toUpperCase();
  const ts = u.slice(0, 10).toLowerCase();
  const rand = u.slice(10).toLowerCase();
  if (!CROCKFORD_BASE32.test(ts) || !CROCKFORD_BASE32.test(rand)) {
    throw new Error('Invalid ULID alphabet (Crockford base32 expected).');
  }
  if (rand.length !== 16 || ts.length !== 10) {
    throw new Error('Invalid ULID segmentation (expected 10+16).');
  }
  return { rand, ts };
}

export function entityIdPartsToUlid(parts: EntityIdParts): string {
  const ts = parts.ts.toUpperCase();
  const rand = parts.rand.toUpperCase();
  if (ts.length !== 10 || rand.length !== 16) {
    throw new Error('Invalid ULID segments (expected ts=10, rand=16).');
  }
  if (!CROCKFORD_BASE32.test(ts) || !CROCKFORD_BASE32.test(rand)) {
    throw new Error('Invalid ULID alphabet (Crockford base32 expected).');
  }
  return `${ts}${rand}`;
}

export function fromUlid(prefix: string, ulid: string): EntityId {
  const p = normalizePrefix(prefix);
  const { rand, ts } = ulidToEntityIdParts(ulid);
  return `${p}_${rand}.${ts}` as EntityId;
}

export type CreateEntityIdOptions = Readonly<{
  /**
   * Prefer per-process monotonic ULID generation to reduce collisions and ensure
   * stable ordering for IDs generated within the same millisecond in this process.
   *
   * Default: true.
   */
  monotonic?: boolean;
  /**
   * Provide an explicit timestamp (milliseconds since Unix epoch). When omitted,
   * the current time is used.
   */
  timeMs?: number;
}>;

export function createEntityId(
  prefix: string,
  options: CreateEntityIdOptions = {}
): EntityId {
  const p = normalizePrefix(prefix);
  const monotonic = options.monotonic ?? true;
  const timeMs = options.timeMs;

  let u: string;
  if (timeMs === undefined) {
    u = monotonic ? ulidMonotonic() : ulidCanonical();
  } else {
    u = monotonic ? ulidMonotonic(timeMs) : ulidCanonical(timeMs);
  }

  return fromUlid(p, u);
}

export function isEntityId(value: string): value is EntityId {
  return ENTITY_ID_RE.test(value);
}

/**
 * Schema requiring a specific prefix (normalized via `normalizePrefix`).
 */
export function entityIdWithPrefixSchema(prefix: string) {
  const p = normalizePrefix(prefix);
  return entityIdSchema.superRefine((value: string, ctx: z.RefinementCtx) => {
    if (!String(value).startsWith(`${p}_`)) {
      ctx.addIssue({
        code: 'custom',
        message: `Entity id must start with "${p}_"`,
      });
    }
  });
}

export function parseEntityId(value: string): ParsedEntityId {
  const match = ENTITY_ID_RE.exec(value);
  if (!match) {
    throw new Error(
      'Invalid entity id. Expected "<prefix>_<rand16>.<ts10>" with ULID Crockford base32.'
    );
  }

  const prefix = requiredGroup(match.groups, 'prefix');
  const rand = requiredGroup(match.groups, 'rand').toLowerCase();
  const ts = requiredGroup(match.groups, 'ts').toLowerCase();

  // Extra safety: even though the regex restricts, normalize and re-check.
  const normalizedPrefix = normalizePrefix(prefix);
  if (!CROCKFORD_BASE32.test(rand) || !CROCKFORD_BASE32.test(ts)) {
    throw new Error('Invalid ULID alphabet (Crockford base32 expected).');
  }

  const ulid = `${ts}${rand}`.toUpperCase();
  const timeMs = decodeUlidTime(ulid);

  return {
    prefix: normalizedPrefix,
    rand,
    ts,
    ulid,
    timeMs,
  };
}

export function normalizeEntityId(value: string): EntityId {
  const parsed = parseEntityId(value);
  return `${parsed.prefix}_${parsed.rand}.${parsed.ts}` as EntityId;
}

export type EntityIdTuple = readonly [
  prefix: string,
  rand: string,
  iso: string,
  timeMs: number,
];

export function entityIdToTuple(entityId: string): EntityIdTuple {
  const parsed = parseEntityId(entityId);
  return [
    parsed.prefix,
    parsed.rand,
    new Date(parsed.timeMs).toISOString(),
    parsed.timeMs,
  ] as const;
}

export function entityIdToTimeMs(entityId: string): number {
  return parseEntityId(entityId).timeMs;
}

export function entityIdToIso(entityId: string): string {
  return new Date(entityIdToTimeMs(entityId)).toISOString();
}

export function entityIdTsToTimeMs(ts: string): number {
  const normalized = ts.trim();
  if (!TS_RE.test(normalized)) {
    throw new Error(
      'Invalid ULID time segment. Expected 10 chars Crockford base32.'
    );
  }
  return decodeUlidTime(`${normalized}0000000000000000`.toUpperCase());
}

export function toUlid(entityId: string): string {
  const parsed = parseEntityId(entityId);
  return parsed.ulid.toUpperCase();
}

export function getEntityIdTimeMs(entityId: string): number {
  return parseEntityId(entityId).timeMs;
}

export type EntityIdCompareMode = 'time' | 'string';

export function compareEntityIds(
  a: string,
  b: string,
  mode: EntityIdCompareMode = 'string'
): number {
  switch (mode) {
    case 'string':
      return a.localeCompare(b);
    case 'time': {
      const at = getEntityIdTimeMs(a);
      const bt = getEntityIdTimeMs(b);
      if (at !== bt) return at < bt ? -1 : 1;
      // Same timestamp: fall back to ULID randomness for stable ordering.
      return toUlid(a).localeCompare(toUlid(b));
    }
    default:
      return assertNever(mode);
  }
}
