import { z } from 'zod';

export const SPACE_INVITE_NOTIFY_SCHEMA_VERSION = 2 as const;

export const spaceInviteNotifyEvent = 'space_invite.email_requested' as const;

const envelopeBase = {
  schema_version: z.literal(SPACE_INVITE_NOTIFY_SCHEMA_VERSION),
  source_hook: z.string().optional(),
};

const inviteCore = z.object({
  id: z.string(),
  space_id: z.string(),
  email: z.string(),
  token: z.string(),
  role_key: z.string(),
  expires_at: z.string(),
});

export const spaceInviteNotifyEnvelopeSchema = z.object({
  ...envelopeBase,
  event: z.literal(spaceInviteNotifyEvent),
  invite: inviteCore,
  space: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  organization: z.object({
    name: z.string(),
  }),
});

export type SpaceInviteNotifyEnvelope = z.infer<
  typeof spaceInviteNotifyEnvelopeSchema
>;

export const spaceInviteNotifyInternalIngestSchema = z.object({
  event: z.literal(spaceInviteNotifyEvent),
  invite: inviteCore,
  space: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  organization: z.object({
    name: z.string(),
  }),
});

export type SpaceInviteNotifyInternalIngest = z.infer<
  typeof spaceInviteNotifyInternalIngestSchema
>;

export function parseSpaceInviteNotifyEnvelope(raw: unknown) {
  return spaceInviteNotifyEnvelopeSchema.safeParse(raw);
}

export function parseSpaceInviteNotifyInternalIngest(raw: unknown) {
  return spaceInviteNotifyInternalIngestSchema.safeParse(raw);
}

export function toSpaceInviteNotifyEnvelope(
  internal: SpaceInviteNotifyInternalIngest,
  sourceHook: string
): SpaceInviteNotifyEnvelope {
  return {
    schema_version: SPACE_INVITE_NOTIFY_SCHEMA_VERSION,
    source_hook: sourceHook,
    event: spaceInviteNotifyEvent,
    invite: internal.invite,
    space: internal.space,
    organization: internal.organization,
  };
}
