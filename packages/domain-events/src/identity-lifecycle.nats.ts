import type { IdentityLifecycleEventName } from './identity-lifecycle.js';

/** JetStream stream name (dev/prod configurable via env). */
export const IDENTITY_LIFECYCLE_STREAM_NAME = 'IDENTITY_LIFECYCLE' as const;

/** Subject prefix; stream should use `identity.lifecycle.v1.>` or equivalent. */
export const IDENTITY_LIFECYCLE_SUBJECT_PREFIX =
  'identity.lifecycle.v1' as const;

export function identityLifecycleJetStreamSubject(
  event: IdentityLifecycleEventName
): string {
  const suffix = event.replace(/\./g, '_');
  return `${IDENTITY_LIFECYCLE_SUBJECT_PREFIX}.${suffix}`;
}
