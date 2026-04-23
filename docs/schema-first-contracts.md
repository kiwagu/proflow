# Schema-first contracts

This document defines how contracts should be expressed in the repository.

The goal is to preserve the duality of every important **data contract**:

- **dynamic form** for runtime parsing, validation, normalization, and branding
- **static form** for type-safe reuse, inheritance, and composition

The default source of truth for that duality is **Zod**.

## Core definition

A contract is **schema-first** when:

1. the exported data shape is defined with a Zod schema
2. the exported TypeScript type is inferred from that schema
3. runtime entry points use the schema for parse or safeParse where boundary validation is required

Canonical shape:

```ts
import { z } from 'zod';

export const exampleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
});

export type Example = z.infer<typeof exampleSchema>;
```

## Why this rule exists

Without this rule, the repository drifts into duplicated truth:

- one definition for TypeScript
- another for runtime validation
- a third, implicit one in handlers, workers, or SQL assumptions

Schema-first contracts reduce that drift and give the agent a reliable place to start.

## Contract categories

### 1. Data contracts

These should be **Zod-first**.

Examples:

- domain event payloads
- route request and response bodies
- server action inputs
- queue and worker messages
- RPC argument and result payloads
- filters and DTOs
- config contracts
- identifiers and value objects
- aggregate or entity snapshots when exported as data

### 2. Behavioral contracts

These should stay **TypeScript-first**, but should depend on schema-first data contracts at their boundaries.

Examples:

- repository ports
- gateway ports
- policy interfaces
- use-case interfaces
- application services

Behavioral contracts describe methods, semantics, and side effects. Zod is not the primary tool for that.

## Repository rule

### Mandatory by default

- events
- transport payloads
- worker payloads
- DTOs
- filters
- config/env objects
- IDs and value-object state
- persisted JSON contracts

### Recommended

- use-case input and output objects
- port method input and output objects
- entity or aggregate snapshots
- read models

### Not required by default

- local private implementation-only types
- method-local temporary objects
- the port interface itself
- rich entities whose primary contract is behavior

## Naming and export convention

### Base convention

- Schema: `<name>Schema`
- Static type: `<Name> = z.infer<typeof <name>Schema>`
- Runtime parser helper when useful: `parse<Name>` or `safeParse<Name>`

Examples:

```ts
export const userFilterSchema = z.object({ ... });
export type UserFilter = z.infer<typeof userFilterSchema>;

export function parseUserFilter(raw: unknown) {
  return userFilterSchema.safeParse(raw);
}
```

### For IDs and value objects

- Use Zod transforms, refine, and branding when the runtime contract also normalizes data.
- Prefer branded static types inferred from the schema pipeline when that pattern is already in use.

Example shape:

```ts
export const entityIdSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0)
  .brand<'EntityId'>();

export type EntityId = z.infer<typeof entityIdSchema>;
```

### For event contracts

- Export the event constant, schema version constant, schema, inferred type, and parse helper together.
- If the repository uses both internal-ingest and external-envelope forms, define both explicitly.

Example shape:

```ts
export const USER_CREATED_SCHEMA_VERSION = 1 as const;
export const userCreatedEvent = 'user.created' as const;

export const userCreatedSchema = z.object({
  schema_version: z.literal(USER_CREATED_SCHEMA_VERSION),
  event: z.literal(userCreatedEvent),
  user: z.object({
    id: z.string(),
  }),
});

export type UserCreated = z.infer<typeof userCreatedSchema>;
```

### For filters, commands, and DTOs

- Keep the schema and inferred type in the same module.
- Export supported enums and helpers from the same module when they are part of the contract.

### For ports

- Keep the port itself in TypeScript.
- Use schema-first contracts for input and output payloads when those shapes are shared or boundary-relevant.

Example:

```ts
import { z } from 'zod';

export const createInviteInputSchema = z.object({
  spaceId: z.string(),
  email: z.string().email(),
});

export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;

export interface SpaceInviteRepository {
  create(input: CreateInviteInput): Promise<void>;
}
```

The schema defines the data contract. The interface defines the behavioral contract.

### For entities and domain models

- Do not reduce a rich entity to a raw Zod object if behavior is the real point of the model.
- When the entity needs an exported state or snapshot contract, define that state schema separately.

Example:

```ts
export const membershipStateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  spaceId: z.string(),
  status: z.enum(['active', 'invited', 'suspended']),
});

export type MembershipState = z.infer<typeof membershipStateSchema>;

export type Membership = Readonly<{
  state: MembershipState;
  canInvite(): boolean;
}>;
```

This keeps data duality without pretending behavior is just a JSON shape.

## Runtime expectation

At real boundaries, use the schema.

Typical places:

- route handlers
- worker consumers
- server actions
- event ingest points
- config loading
- adapter boundaries where untrusted input enters

Use `parse` when invalid input is exceptional and should stop execution.

Use `safeParse` when the caller needs structured failure handling.

## Relationship to domain/application/infrastructure contexts

- In the **domain context**, schema-first contracts define the stable data vocabulary: IDs, events, value-object state, filters, snapshots.
- In the **application context**, schema-first contracts validate commands, DTOs, orchestration input, and event intake.
- In the **infrastructure context**, schemas validate adapter input and output at boundaries, but infrastructure should not redefine domain meaning.

## Good repository examples

- `packages/entity-id` — ID contract plus normalization and branding
- `packages/domain-events` — event contracts with schema versioning and inferred types
- `packages/db/src/contracts` — filter and query contracts

## Anti-patterns

- Exporting a manual TS type and a separate schema for the same boundary object.
- Writing boundary contracts as TypeScript-only and hoping callers behave.
- Using Zod to model an entire behavioral port instead of the port's data contracts.
- Duplicating event field names in three places: type, schema, and handler assumptions.
- Treating every internal object as a boundary contract and flooding the codebase with unnecessary schemas.

## Fast checklist

When a module exports a contract, ask:

1. Is this a **data contract** or a **behavioral contract**?
2. If it is data, where is the Zod schema?
3. Is the exported type inferred from that schema?
4. Does a runtime boundary actually parse or safeParse it?
5. If this is behavioral, are its input/output data shapes still schema-first where needed?

If the answer to 2 or 3 is no for a real boundary contract, the module is probably missing the repository standard.