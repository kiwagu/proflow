# Entity IDs (`@workspace/entity-id`)

The repo's id toolkit is the published
[`entity-id`](https://www.npmjs.com/package/entity-id) package: wire contract,
minting, decoding, guards and zod schemas. This workspace package re-exports it
whole and adds only what is proflow's own (`src/registry.ts`):

- `ENTITY_PREFIXES` and `entityIdRegistry` — the prefix catalog, declared once
  through the package's `defineEntityPrefixes`, with one factory per kind
  (`entityIdRegistry.factories.spaceIdFactory.create()`);
- the id vocabulary as types (`SpaceId`, `DocumentId`, `WriterId`, …);
- `entityIdSchemas` — the package's `withSchemas(entityIdRegistry)`;
- `strictEntityIdSchemaFor(kind)` — a full-depth per-kind schema (see below).

**Validation depth is a mode.** The package's default (`mixed`) checks only the
`<prefix>_` head in `isEntityId`, the factories' `is`/`assert`, `parseEntityId` and
the per-kind `entityIdSchemas.<kind>.schema`. Nothing in the repo sets the mode. Where
the full contract matters, use `strictEntityIdSchema` / `strictEntityIdSchemaFor(kind)`
or pass `{ mode: 'full' }` per call. Contract fields default to the prefix gate
`entityIdSchemas.<kind>.prefixSchema`, which is mode-independent.

The format is optimized for **operator / developer DX** while staying equivalent
to a canonical **ULID** payload (time + randomness).

## Contract

### String shape

```
<prefix>_<rand>.<ts>
```

- **`prefix`**: entity type catalog key.
  - Allowed: lowercase ASCII letters/digits, must start with a letter.
  - Regex: `[a-z][a-z0-9]{1,15}`
- Separator after prefix: `_` (underscore).
- **`rand`**: **16 chars** ULID randomness segment (80 bits), Crockford Base32.
- Separator between segments: `.` (dot).
- **`ts`**: **10 chars** ULID time segment (48 bits, milliseconds since Unix epoch),
  Crockford Base32.

### Alphabet

ULID Crockford Base32 alphabet (case-insensitive on input):

```
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

Notes:

- The alphabet intentionally excludes ambiguous characters (`I`, `L`, `O`, `U`).
- The implementation **accepts mixed case** on input but **emits lowercase**.

### Normalization

- `prefix` is kept **lowercase**.
- `rand` and `ts` are normalized to **lowercase**.

### Canonical ULID equivalence

For any valid `<prefix>_<rand>.<ts>`:

- `ulid = <ts><rand>` (26 chars)
- `ts = ulid.slice(0, 10)`
- `rand = ulid.slice(10)`

### Sorting and pagination

- This format is **not** lexicographically time-sortable by the whole string,
  because `rand` comes before `ts`.
- Use `created_at` / `created_ms` for ordering in list APIs.
  If you must sort by the time embedded in `id`, extract `ts` and sort on it
  (prefer a generated column in Postgres).
- `ts` alone **is** lexicographically sortable as a 10-char Crockford Base32
  ULID time segment (milliseconds since Unix epoch). Within the same millisecond,
  use the full ULID (`<ts><rand>`) for a stable secondary order.

### Collision and uniqueness

- Uniqueness is provided by `rand` (80 bits). Collisions are _negligible_ but
  still protect with a DB `UNIQUE` constraint (or `PRIMARY KEY`) as usual.
- Copy/paste convenience: everything **before the dot** (`<prefix>_<rand>`) is
  effectively a globally-unique handle (probabilistically, ULID-strength).

## Mongo / Payload (Mongoose) guidance

MongoDB supports string `_id`.

In this repo we intentionally use the **string `id` / `_id`** pattern for selected
collections (e.g. users in `apps/author`) so the Mongo primary key matches the
canonical `entity_id` from Postgres events. This is enforced by `@workspace/payload-plugins`
in `mode: "validate"` (the ID is provided externally; the plugin validates it).

If you introduce new Payload collections, decide explicitly:

- **String `_id` (entity id)**: best for cross-system joins and operator DX, but ensure
  no code assumes `ObjectId`.
- **Default ObjectId + `publicId` field**: safer with third-party assumptions, but you
  must map between ObjectId and the cross-system ID.

## API (summary)

See the published package's README for the full API. The common calls:

- `entityIdRegistry.factories.<kind>IdFactory` — `create()`, `is(v, { mode })`,
  `assert(v, { mode })`, `brand(v)` (trusted casts only)
- `createEntityId(prefix)` → `<prefix>_<rand>.<ts>`
- `parseEntityId(value, { mode: 'full' })` → `{ prefix, rand, ts, ulid, timeMs, iso }`
- `isEntityId(value, { mode: 'full' })` and `normalizeEntityId(value)` (always full)
- `entityIdSchemas.<kind>.prefixSchema`, `strictEntityIdSchemaFor(kind)`,
  `strictEntityIdSchema`

## Operator tooling (CLI)

The published package ships a CLI for minting and inspecting ids:

```bash
bunx entity-id new usr
bunx entity-id inspect "usr_mkg2pqwyacy14bym.01kn21dwmd"
```

## Postgres query/index notes

- Equality lookups are covered by the `unique(entity_id)` btree index.
- If you plan to query by entity prefix (e.g. `where entity_id like 'usr_%'`), prefer a
  `text_pattern_ops` index (see `public.profiles` migration in this repo).
- Do not rely on `order by entity_id` for recency; use `created_at` or extract `ts`.
