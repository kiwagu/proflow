/**
 * Central catalog of every entity-id prefix in the system — one prefix per
 * kind, each unique and well-formed (`PREFIX_RE`).
 *
 * Single source of truth for the prefix that goes into `<prefix>_<rand16>.<ts10>`
 * across all three producers: Postgres column defaults
 * (`entity_id_generate('<prefix>')`), the Payload custom-id plugin's `prefixMap`,
 * and app-side `createEntityId('<prefix>')` call sites.
 *
 * Prefixes are declared statically, so their two invariants are asserted once in
 * CI (`registry.test.ts`) rather than re-checked at runtime on every boot:
 *   1. uniqueness — no two kinds share a prefix (an `xxx_…` id must route back to
 *      exactly one kind; the classic hazard is two slugs compressing to the same
 *      short prefix, e.g. `program`/`project` → `pr…`);
 *   2. shape — each matches `PREFIX_RE`.
 * `sql-sync.test.ts` additionally asserts the DB and this catalog never drift:
 * every `entity_id_generate('x')` prefix in a migration is registered here.
 *
 * `derivePrefixFromSlug` / `ensureUniquePrefix` (in `index.ts`) stay for the day a
 * prefix is minted from a slug at runtime rather than hand-picked; only then would
 * a runtime uniqueness guard earn its keep again.
 *
 * The keys are stable semantic entity names (not table names) so renaming a table
 * does not churn this file; the values are the wire prefixes and MUST match the DB.
 */
export const ENTITY_PREFIXES = {
  // Identity & platform tenancy
  user: 'usr',
  organization: 'org',
  space: 'spc',
  spaceInvite: 'spi',
  spaceAdminAuditLog: 'sal',

  // RBAC
  role: 'rol',
  permission: 'prm',
  userRole: 'url',

  // Operator critical-capability JIT (private schema)
  operatorCapabilityGrant: 'ocg',
  operatorCapabilitySession: 'ocs',
  operatorCapabilityAudit: 'oca',

  // Legacy content + scoping
  contentItem: 'cnt',
  scope: 'scp',

  // Platform infrastructure
  outboxJob: 'out',
  runtimeSetting: 'rts',

  // Knowledge graph core
  knowledgeResource: 'knr',
  knowledgeEdge: 'kne',
  projection: 'prj',
  resourceUserState: 'rus',
  reportingLine: 'rpl',

  // Knowledge-base satellites (kb schema)
  kbResourceDescription: 'krd',
  kbResourceActivity: 'kra',
  kbResourceLink: 'krl',
  kbMediaBlob: 'kmb',
  kbResourceMediaMeta: 'kmm',

  // Payload (Author app) documents
  body: 'bod',
} as const satisfies Record<string, string>;

/** Semantic entity name — a key of {@link ENTITY_PREFIXES}. */
export type EntityKind = keyof typeof ENTITY_PREFIXES;

/** A registered wire prefix — a value of {@link ENTITY_PREFIXES}. */
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityKind];

/** All registered prefixes, sorted, as a plain string list. */
export const ALL_ENTITY_PREFIXES: readonly string[] = Object.freeze(
  Object.values(ENTITY_PREFIXES).sort()
);

/** Every registered entity kind (catalog key), in declaration order. */
export const ENTITY_KINDS: readonly EntityKind[] = Object.freeze(
  Object.keys(ENTITY_PREFIXES) as EntityKind[]
);

/** The registered prefix for a known entity. Type-safe: unknown names won't compile. */
export function prefixFor(kind: EntityKind): EntityPrefix {
  return ENTITY_PREFIXES[kind];
}

/** Whether a string is a registered entity kind. Narrows to {@link EntityKind}. */
export function isEntityKind(value: string): value is EntityKind {
  return Object.prototype.hasOwnProperty.call(ENTITY_PREFIXES, value);
}

/** Whether a prefix string is registered. Narrows to {@link EntityPrefix}. */
export function isRegisteredPrefix(prefix: string): prefix is EntityPrefix {
  return (Object.values(ENTITY_PREFIXES) as string[]).includes(prefix);
}

/** The semantic entity kind that owns a registered prefix, or `undefined`. */
export function entityKindForPrefix(prefix: string): EntityKind | undefined {
  for (const kind of ENTITY_KINDS) {
    if (ENTITY_PREFIXES[kind] === prefix) return kind;
  }
  return undefined;
}
