import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
  type E2EPlatformOrgBootstrap,
} from './helpers/platform-org-bootstrap.js';

test.describe('author shell gateway entry', () => {
  test('@smoke guest visiting /author is sent to platform sign-in', async ({
    page,
  }) => {
    await page.goto('/author');
    await expect(page).toHaveURL(/\/platform/);
    await expect(page.getByTestId('auth-login-form')).toBeVisible();
  });

  test('@smoke guest visiting /author/admin is sent to platform sign-in', async ({
    page,
  }) => {
    await page.goto('/author/admin');
    await expect(page).toHaveURL(/\/platform/);
    await expect(page.getByTestId('auth-login-form')).toBeVisible();
  });

  test('@smoke authenticated user reaches Payload admin after platform login', async ({
    page,
    seededUser,
  }) => {
    let bootstrap: E2EPlatformOrgBootstrap | undefined;
    try {
      bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);

      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });
      await page.goto('/author', { timeout: 60_000 });
      await expect(page).toHaveURL(/\/author\/admin/i, { timeout: 60_000 });
    } finally {
      if (bootstrap) await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
});
