import type { SpaceOrgLifecycleEventName } from './space-org-lifecycle.js';

export const SPACE_ORG_LIFECYCLE_STREAM_NAME = 'SPACE_ORG_LIFECYCLE' as const;

export const SPACE_ORG_LIFECYCLE_SUBJECT_PREFIX =
  'space_org.lifecycle.v1' as const;

export function spaceOrgLifecycleJetStreamSubject(
  event: SpaceOrgLifecycleEventName
): string {
  const suffix = event.replace(/\./g, '_');
  return `${SPACE_ORG_LIFECYCLE_SUBJECT_PREFIX}.${suffix}`;
}
