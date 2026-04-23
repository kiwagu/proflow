import { z } from 'zod';

export const SPACE_ORG_LIFECYCLE_EVENTS = [
  'organization.created',
  'organization.updated',
  'organization.deleted',
  'space.created',
  'space.updated',
  'space.deleted',
  'space_membership.created',
  'space_membership.updated',
  'space_membership.deleted',
] as const;

export type SpaceOrgLifecycleEventName =
  (typeof SPACE_ORG_LIFECYCLE_EVENTS)[number];

export const SPACE_ORG_LIFECYCLE_SCHEMA_VERSION = 1 as const;

const envelopeBase = {
  schema_version: z.literal(SPACE_ORG_LIFECYCLE_SCHEMA_VERSION),
  source_hook: z.string().optional(),
};

const organizationPayload = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  parent_organization_id: z.string().nullable().optional(),
});

const spacePayload = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
});

const membershipPayload = z.object({
  space_id: z.string(),
  user_id: z.string(),
  status: z.enum(['active', 'invited', 'suspended']),
});

export const spaceOrgLifecycleEnvelopeSchema = z.discriminatedUnion('event', [
  z.object({
    ...envelopeBase,
    event: z.literal('organization.created'),
    organization: organizationPayload,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('organization.updated'),
    organization: organizationPayload,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('organization.deleted'),
    organization: z.object({ id: z.string() }),
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('space.created'),
    space: spacePayload,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('space.updated'),
    space: spacePayload,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('space.deleted'),
    space: z.object({ id: z.string(), organization_id: z.string().optional() }),
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('space_membership.created'),
    membership: membershipPayload,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('space_membership.updated'),
    membership: membershipPayload,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('space_membership.deleted'),
    membership: z.object({
      space_id: z.string(),
      user_id: z.string(),
    }),
  }),
]);

export type SpaceOrgLifecycleEnvelope = z.infer<
  typeof spaceOrgLifecycleEnvelopeSchema
>;

export const spaceOrgLifecycleInternalIngestSchema = z.discriminatedUnion(
  'event',
  [
    z.object({
      event: z.literal('organization.created'),
      organization: organizationPayload,
    }),
    z.object({
      event: z.literal('organization.updated'),
      organization: organizationPayload,
    }),
    z.object({
      event: z.literal('organization.deleted'),
      organization: z.object({ id: z.string() }),
    }),
    z.object({
      event: z.literal('space.created'),
      space: spacePayload,
    }),
    z.object({
      event: z.literal('space.updated'),
      space: spacePayload,
    }),
    z.object({
      event: z.literal('space.deleted'),
      space: z.object({
        id: z.string(),
        organization_id: z.string().optional(),
      }),
    }),
    z.object({
      event: z.literal('space_membership.created'),
      membership: membershipPayload,
    }),
    z.object({
      event: z.literal('space_membership.updated'),
      membership: membershipPayload,
    }),
    z.object({
      event: z.literal('space_membership.deleted'),
      membership: z.object({
        space_id: z.string(),
        user_id: z.string(),
      }),
    }),
  ]
);

export type SpaceOrgLifecycleInternalIngest = z.infer<
  typeof spaceOrgLifecycleInternalIngestSchema
>;

export function parseSpaceOrgLifecycleEnvelope(raw: unknown) {
  return spaceOrgLifecycleEnvelopeSchema.safeParse(raw);
}

export function parseSpaceOrgLifecycleInternalIngest(raw: unknown) {
  return spaceOrgLifecycleInternalIngestSchema.safeParse(raw);
}

export function toSpaceOrgLifecycleEnvelope(
  internal: SpaceOrgLifecycleInternalIngest,
  sourceHook: string
): SpaceOrgLifecycleEnvelope {
  const meta = {
    schema_version: SPACE_ORG_LIFECYCLE_SCHEMA_VERSION,
    source_hook: sourceHook,
  } as const;

  switch (internal.event) {
    case 'organization.created':
      return {
        ...meta,
        event: 'organization.created',
        organization: internal.organization,
      };
    case 'organization.updated':
      return {
        ...meta,
        event: 'organization.updated',
        organization: internal.organization,
      };
    case 'organization.deleted':
      return {
        ...meta,
        event: 'organization.deleted',
        organization: internal.organization,
      };
    case 'space.created':
      return { ...meta, event: 'space.created', space: internal.space };
    case 'space.updated':
      return { ...meta, event: 'space.updated', space: internal.space };
    case 'space.deleted':
      return { ...meta, event: 'space.deleted', space: internal.space };
    case 'space_membership.created':
      return {
        ...meta,
        event: 'space_membership.created',
        membership: internal.membership,
      };
    case 'space_membership.updated':
      return {
        ...meta,
        event: 'space_membership.updated',
        membership: internal.membership,
      };
    case 'space_membership.deleted':
      return {
        ...meta,
        event: 'space_membership.deleted',
        membership: internal.membership,
      };
    default: {
      const _exhaustive: never = internal;
      return _exhaustive;
    }
  }
}
