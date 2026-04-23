import type { IdentityLifecycleEnvelope } from '@workspace/domain-events';

/**
 * Author shell: whether this identity lifecycle event should mutate Payload users.
 *
 * LLM / future-work context:
 * - Return `false` to skip `applyIdentityLifecycleEvent` while still ack-ing the JetStream message
 *   — e.g. users tagged in `user_metadata` / `app_metadata` as non-authors when multiple apps
 *   share the same stream (filter with a dedicated consumer `filter_subject` when possible).
 */
export function shouldApplyIdentityLifecycleToAuthorShell(
  _body: IdentityLifecycleEnvelope
): boolean {
  return true;
}
