import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

test.describe('platform space invites', () => {
  test('@smoke invalid invite start shows error page', async ({ page }) => {
    await page.goto(
      '/platform/invite/start?t=00000000-e2e-invalid-token-00000000'
    );
    await expect(page).toHaveURL(/\/platform\/invite\/error/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('invite-error-title')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('invite-error-detail')).toBeVisible();
  });

  test('@smoke org admin can create a pending space invite', async ({
    page,
    seededUser,
  }) => {
    const bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    try {
      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });

      await page.goto('/platform/space-settings');
      await expect(
        page.getByRole('heading', { name: 'Space settings' })
      ).toBeVisible({ timeout: 30_000 });

      const manager = page.getByTestId(
        `space-invite-manager-${bootstrap.spaceId}`
      );
      await expect(manager).toBeVisible({ timeout: 15_000 });

      const form = manager.getByTestId(
        `space-invite-form-${bootstrap.spaceId}`
      );

      const inviteEmail = `e2e-invitee-${Date.now()}@example.test`;
      await form.getByPlaceholder('colleague@example.com').fill(inviteEmail);
      await form.getByRole('button', { name: 'Create invite' }).click();

      await expect(
        manager.getByTestId(`space-invite-token-banner-${bootstrap.spaceId}`)
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
});
