import {
  decodeTime as decodeUlidTime,
  monotonicFactory,
  ulid as ulidCanonical,
} from 'ulid';
import { z } from 'zod';

import { ENTITY_PREFIXES, type EntityKind, prefixFor } from './registry.js';

export * from './registry.js';

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
export const PREFIX_RE = /^[a-z][a-z0-9]{1,15}$/;
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

/**
 * Registry-safe variant of {@link createEntityId}: takes a semantic
 * {@link EntityName} instead of a raw prefix string, so the prefix is resolved
 * from the canonical registry and typos / duplicate prefixes cannot reach here.
 * Prefer this over `createEntityId('literal')` at app call sites.
 */
export function createEntityIdFor<K extends EntityKind>(
  kind: K,
  options: CreateEntityIdOptions = {}
): EntityIdOf<K> {
  return createEntityId(prefixFor(kind), options) as EntityIdOf<K>;
}

export function isEntityId(value: string): value is EntityId {
  return ENTITY_ID_RE.test(value);
}

/**
 * Schema requiring a specific prefix (normalized via `normalizePrefix`). The
 * prefix is a runtime argument, so this doubles as the dynamic zod-schema
 * factory for a prefix known only at runtime. Output is branded `EntityId`.
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

/**
 * A distinctly-branded entity id: `EntityId` narrowed by an extra brand tag, so
 * e.g. a `UserId` and a `SpaceId` are different compile-time types (the checker
 * catches passing one where the other is expected) while both remain assignable
 * to `EntityId`. Fixes the "single brand for every id" hazard where the type
 * system could not tell one kind of id from another.
 */
export type BrandedEntityId<Brand extends string> = EntityId & z.BRAND<Brand>;

/**
 * The branded id type for a registered entity kind — the registry-driven
 * per-kind brand. `EntityIdOf<'user'>` is distinct from `EntityIdOf<'space'>`.
 * Prefer the named aliases (`UserId`, `SpaceId`, …) at call sites.
 */
export type EntityIdOf<K extends EntityKind> = BrandedEntityId<K>;

/**
 * Per-type branded schema for a fixed prefix.
 * `brandedEntityIdSchema<'UserId'>('usr')` yields a schema whose parsed output is
 * a `UserId`, distinct from any other branded id. Parsing is the only way to
 * obtain the branded value (parse-to-brand) — the lever behind the repo's
 * parse-at-the-boundary discipline for identifiers.
 */
export function brandedEntityIdSchema<Brand extends string>(prefix: string) {
  return entityIdWithPrefixSchema(prefix).brand<Brand>();
}

/**
 * Runtime type-guard: is `value` a well-formed entity id whose prefix equals
 * `prefix` (known only at runtime)? Narrows to `EntityId`.
 */
export function isEntityIdWithPrefix(
  value: string,
  prefix: string
): value is EntityId {
  return isEntityId(value) && value.startsWith(`${normalizePrefix(prefix)}_`);
}

/**
 * Throwing assert: `value` must be an entity id with `prefix`; returns it
 * normalized + branded. For a compile-time-known type prefer
 * `brandedEntityIdSchema(...).parse(...)`.
 */
export function assertEntityIdWithPrefix(
  value: string,
  prefix: string
): EntityId {
  const p = normalizePrefix(prefix);
  if (!isEntityIdWithPrefix(value, p)) {
    throw new Error(
      `Expected an entity id with prefix "${p}_", got "${value}".`
    );
  }
  return normalizeEntityId(value);
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

/* ------------------------------------------------------------------------- *
 * Registry-driven per-kind branded ids
 *
 * Named aliases + a runtime toolkit, both derived from `ENTITY_PREFIXES`, so
 * every registered entity kind gets a distinct compile-time id type and a
 * create/guard/assert/schema set — all sharing the one canonical format. Adding
 * a kind to the registry is the only edit needed for the toolkit; the aliases
 * below are hand-mirrored for import ergonomics (`id: UserId`).
 * ------------------------------------------------------------------------- */

export type UserId = EntityIdOf<'user'>;
export type OrganizationId = EntityIdOf<'organization'>;
export type SpaceId = EntityIdOf<'space'>;
export type SpaceInviteId = EntityIdOf<'spaceInvite'>;
export type SpaceAdminAuditLogId = EntityIdOf<'spaceAdminAuditLog'>;
export type RoleId = EntityIdOf<'role'>;
export type PermissionId = EntityIdOf<'permission'>;
export type UserRoleId = EntityIdOf<'userRole'>;
export type OperatorCapabilityGrantId = EntityIdOf<'operatorCapabilityGrant'>;
export type OperatorCapabilitySessionId =
  EntityIdOf<'operatorCapabilitySession'>;
export type OperatorCapabilityAuditId = EntityIdOf<'operatorCapabilityAudit'>;
export type ContentItemId = EntityIdOf<'contentItem'>;
export type ScopeId = EntityIdOf<'scope'>;
export type OutboxJobId = EntityIdOf<'outboxJob'>;
export type RuntimeSettingId = EntityIdOf<'runtimeSetting'>;
export type KnowledgeResourceId = EntityIdOf<'knowledgeResource'>;
export type KnowledgeEdgeId = EntityIdOf<'knowledgeEdge'>;
export type ProjectionId = EntityIdOf<'projection'>;
export type ResourceUserStateId = EntityIdOf<'resourceUserState'>;
export type ReportingLineId = EntityIdOf<'reportingLine'>;
export type KbResourceDescriptionId = EntityIdOf<'kbResourceDescription'>;
export type KbResourceActivityId = EntityIdOf<'kbResourceActivity'>;
export type KbResourceLinkId = EntityIdOf<'kbResourceLink'>;
export type KbMediaBlobId = EntityIdOf<'kbMediaBlob'>;
export type KbResourceMediaMetaId = EntityIdOf<'kbResourceMediaMeta'>;
export type BodyId = EntityIdOf<'body'>;
export type DocumentId = EntityIdOf<'document'>;
export type DocumentVersionId = EntityIdOf<'documentVersion'>;
export type DocumentChunkId = EntityIdOf<'documentChunk'>;
export type FileNodeId = EntityIdOf<'fileNode'>;
export type ChatId = EntityIdOf<'chat'>;
export type ChatMessageId = EntityIdOf<'chatMessage'>;
export type ChatMessagePartId = EntityIdOf<'chatMessagePart'>;
export type ChatStreamId = EntityIdOf<'chatStream'>;
export type WriterId = EntityIdOf<'writer'>;

/**
 * The create/guard/assert/schema toolkit for one registered entity kind. All
 * members are branded to `EntityIdOf<K>`, so mixing kinds is a compile error.
 */
export type EntityIdToolkit<K extends EntityKind> = Readonly<{
  /** The entity kind this toolkit is bound to. */
  kind: K;
  /** The registered wire prefix (e.g. `'usr'`). */
  prefix: (typeof ENTITY_PREFIXES)[K];
  /** Mint a fresh, branded id for this kind. Trusted construction. */
  create: (options?: CreateEntityIdOptions) => EntityIdOf<K>;
  /** Runtime type-guard narrowing to this kind's branded id. */
  is: (value: string) => value is EntityIdOf<K>;
  /** Throwing assert → normalized, branded id (parse-at-the-boundary). */
  assert: (value: string) => EntityIdOf<K>;
  /**
   * Explicit UNSTRICT brand: cast a raw string to this kind's branded id with NO
   * runtime validation. For TRUSTED construction only — test fixtures, seed
   * builders, DB-row mapping where the value is already known-good. Never use on
   * untrusted input (use {@link assert} / {@link prefixSchema} / {@link schema}).
   */
  brand: (value: string) => EntityIdOf<K>;
  /**
   * Strict zod schema: validates the FULL `<prefix>_<rand16>.<ts10>` format and
   * brands the parsed output as this kind's id.
   */
  schema: z.ZodType<EntityIdOf<K>>;
  /**
   * Prefix-gated zod schema (the recommended DEFAULT for contract id fields):
   * runtime-checks that the value carries this kind's `<prefix>_` prefix and is
   * non-empty, then brands it — WITHOUT enforcing the full `<rand16>.<ts10>`
   * canonical suffix. This catches a swapped-KIND id at the boundary (a `usr_…`
   * handed to a `spc_…` slot is rejected in runtime, not only at compile time)
   * while tolerating non-canonical placeholder suffixes (`knr_this_id_...`), so
   * fixtures/negative tests that pass a correctly-prefixed but fake id still flow
   * through to the handler's own not-found/denied path. Upgrade to {@link schema}
   * for full-format validation.
   */
  prefixSchema: z.ZodType<EntityIdOf<K>>;
  /**
   * Lenient zod schema: validates only that the value is a non-empty string but
   * brands the output as `EntityIdOf<K>` — a compile-time-only brand with NO
   * runtime prefix check. Use only where the prefix genuinely cannot be
   * guaranteed; prefer {@link prefixSchema} for id fields.
   */
  looseSchema: z.ZodType<EntityIdOf<K>>;
}>;

function makeEntityIdToolkit<K extends EntityKind>(
  kind: K
): EntityIdToolkit<K> {
  const prefix = ENTITY_PREFIXES[kind];
  return {
    kind,
    prefix,
    create: (options?: CreateEntityIdOptions) =>
      createEntityId(prefix, options) as EntityIdOf<K>,
    is: (value: string): value is EntityIdOf<K> =>
      isEntityIdWithPrefix(value, prefix),
    assert: (value: string) =>
      assertEntityIdWithPrefix(value, prefix) as EntityIdOf<K>,
    brand: (value: string) => value as EntityIdOf<K>,
    schema: brandedEntityIdSchema<K>(prefix) as unknown as z.ZodType<
      EntityIdOf<K>
    >,
    prefixSchema: z
      .string()
      .min(1)
      .refine((v) => v.startsWith(`${prefix}_`), {
        message: `Must be a "${prefix}_" entity id`,
      }) as unknown as z.ZodType<EntityIdOf<K>>,
    looseSchema: z.string().min(1) as unknown as z.ZodType<EntityIdOf<K>>,
  };
}

/**
 * Registry-derived toolkit map: one {@link EntityIdToolkit} per entity kind, so
 * `entityIds.user.create()` returns a `UserId`, `entityIds.space.is(x)` guards a
 * `SpaceId`, `entityIds.knowledgeResource.assert(x)` parses at a boundary, etc.
 */
export const entityIds = Object.fromEntries(
  (Object.keys(ENTITY_PREFIXES) as EntityKind[]).map((kind) => [
    kind,
    makeEntityIdToolkit(kind),
  ])
) as unknown as { readonly [K in EntityKind]: EntityIdToolkit<K> };
