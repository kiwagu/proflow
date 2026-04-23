import { getPayload } from 'payload';

import { AUTHOR_USERS_WRITE_CONTEXT } from '../../src/collections/users.sync-context.js';
import config from '../../src/payload.config.js';

export const testUser = {
  email: 'dev@payloadcms.com',
  /** Stable sub for mirrored Payload user (e2e does not call Supabase). */
  supabaseSub: 'e2e-test-supabase-sub',
};

/**
 * Seeds a test user for e2e admin tests (Supabase IdP is not required for e2e).
 */
export async function seedTestUser(): Promise<void> {
  const payload = await getPayload({ config });

  await payload.delete({
    collection: 'users',
    context: AUTHOR_USERS_WRITE_CONTEXT,
    overrideAccess: true,
    where: {
      email: {
        equals: testUser.email,
      },
    },
  });

  await payload.create({
    collection: 'users',
    context: AUTHOR_USERS_WRITE_CONTEXT,
    data: {
      email: testUser.email,
      supabaseSub: testUser.supabaseSub,
    },
    overrideAccess: true,
  });
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  const payload = await getPayload({ config });

  await payload.delete({
    collection: 'users',
    context: AUTHOR_USERS_WRITE_CONTEXT,
    overrideAccess: true,
    where: {
      email: {
        equals: testUser.email,
      },
    },
  });
}
