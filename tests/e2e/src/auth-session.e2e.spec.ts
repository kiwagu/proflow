import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import { expectPlatformProfileReady } from './helpers/platform-profile.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
  type E2EPlatformOrgBootstrap,
} from './helpers/platform-org-bootstrap.js';

test.describe('platform auth session lifecycle', () => {
  test('@smoke user can logout and loses access to protected route', async ({
    page,
    seededUser,
  }) => {
    // login + bootstrap + logout redirect + SSR round-trip can be slow
    // under parallel worker load on the shared dev server.
    test.setTimeout(90_000);

    let bootstrap: E2EPlatformOrgBootstrap | undefined;
    try {
      bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);

      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });
      await expectPlatformProfileReady(page);
      await expect(page.getByTestId('profile-save-submit')).toBeEnabled();

      // Open the NavUser dropdown menu to reveal the logout item
      await page.getByTestId('auth-user-menu-trigger').click();
      await expect(page.getByTestId('auth-logout-button')).toBeVisible();
      await Promise.all([
        page.waitForURL(/\/platform(?:\/|\?|$)/, { timeout: 30_000 }),
        page.getByTestId('auth-logout-button').click(),
      ]);
      await expect(page.getByTestId('auth-login-form')).toBeVisible({
        timeout: 30_000,
      });

      await page.goto('/platform/profile');
      await expect(page).toHaveURL(/\/platform(?:\/|\?|$)/);
      await expect(page.getByTestId('auth-login-form')).toBeVisible();
    } finally {
      if (bootstrap) await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
});
