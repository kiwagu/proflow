import { z } from 'zod';

/** Canonical identity lifecycle events (wire + NATS body). */
export const IDENTITY_LIFECYCLE_EVENTS = [
  'user.created',
  'user.updated',
  'user.deleted',
] as const;

export type IdentityLifecycleEventName =
  (typeof IDENTITY_LIFECYCLE_EVENTS)[number];

export const IDENTITY_LIFECYCLE_SCHEMA_VERSION = 1 as const;

const recordUnknown = z.record(z.string(), z.unknown());

/** User snapshot in lifecycle payloads (create/update; delete may omit metadata). */
export const identityLifecycleUserSchema = z.object({
  id: z.string(),
  entity_id: z.string().optional(),
  email: z.string().nullable().optional(),
  app_metadata: recordUnknown.optional(),
  user_metadata: recordUnknown.optional(),
});

export type IdentityLifecycleUser = z.infer<typeof identityLifecycleUserSchema>;

const envelopeBase = {
  schema_version: z.literal(IDENTITY_LIFECYCLE_SCHEMA_VERSION),
  source_hook: z.string().optional(),
};

export const identityLifecycleEnvelopeSchema = z.discriminatedUnion('event', [
  z.object({
    ...envelopeBase,
    event: z.literal('user.created'),
    user: identityLifecycleUserSchema,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('user.updated'),
    user: identityLifecycleUserSchema,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('user.deleted'),
    user: identityLifecycleUserSchema,
  }),
]);

export type IdentityLifecycleEnvelope = z.infer<
  typeof identityLifecycleEnvelopeSchema
>;

/**
 * Internal ingest body from Postgres triggers (no schema_version).
 * Edge normalizes to {@link IdentityLifecycleEnvelope}.
 */
export const identityLifecycleInternalIngestSchema = z.discriminatedUnion(
  'event',
  [
    z.object({
      event: z.literal('user.created'),
      user: z.object({
        id: z.string(),
        entity_id: z.string().optional(),
        email: z.string().nullable().optional(),
        app_metadata: recordUnknown.optional(),
        user_metadata: recordUnknown.optional(),
      }),
    }),
    z.object({
      event: z.literal('user.updated'),
      user: z.object({
        id: z.string(),
        entity_id: z.string().optional(),
        email: z.string().nullable().optional(),
        app_metadata: recordUnknown.optional(),
        user_metadata: recordUnknown.optional(),
      }),
    }),
    z.object({
      event: z.literal('user.deleted'),
      user: z.object({
        id: z.string(),
        entity_id: z.string().optional(),
        email: z.string().nullable().optional(),
      }),
    }),
  ]
);

export type IdentityLifecycleInternalIngest = z.infer<
  typeof identityLifecycleInternalIngestSchema
>;

export function parseIdentityLifecycleEnvelope(raw: unknown) {
  return identityLifecycleEnvelopeSchema.safeParse(raw);
}

export function parseIdentityLifecycleInternalIngest(raw: unknown) {
  return identityLifecycleInternalIngestSchema.safeParse(raw);
}

/** Map internal ingest to canonical envelope for JetStream / HTTP subscribers. */
export function toIdentityLifecycleEnvelope(
  internal: IdentityLifecycleInternalIngest,
  sourceHook: string
): IdentityLifecycleEnvelope {
  return {
    schema_version: IDENTITY_LIFECYCLE_SCHEMA_VERSION,
    source_hook: sourceHook,
    event: internal.event,
    user: {
      id: internal.user.id,
      entity_id:
        'entity_id' in internal.user ? internal.user.entity_id : undefined,
      email: internal.user.email ?? null,
      app_metadata:
        'app_metadata' in internal.user
          ? internal.user.app_metadata
          : undefined,
      user_metadata:
        'user_metadata' in internal.user
          ? internal.user.user_metadata
          : undefined,
    },
  };
}
