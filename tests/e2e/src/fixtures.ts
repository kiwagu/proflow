import { test as base } from '@playwright/test';

import {
  cleanupTestUser,
  seedTestUser,
  type SeededUser,
} from './helpers/test-user.js';

type E2EFixtures = {
  seededUser: SeededUser;
};

export const test = base.extend<E2EFixtures>({
  // Playwright requires object destructuring for the fixtures argument (not `_`).
  // eslint-disable-next-line no-empty-pattern -- required by @playwright/test fixture API
  seededUser: async ({}, use) => {
    const seededUser = await seedTestUser();
    try {
      await use(seededUser);
    } finally {
      await cleanupTestUser(seededUser.id);
    }
  },
});

export { expect } from '@playwright/test';
