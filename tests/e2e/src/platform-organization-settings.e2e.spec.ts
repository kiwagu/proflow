import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapAdditionalSpaceAdminForUser,
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
  type E2EPlatformOrgBootstrap,
} from './helpers/platform-org-bootstrap.js';
import { selectShadcnOption } from './helpers/select.js';

test.describe('platform organization settings', () => {
  test('@smoke org admin can manage rollout and persist locale', async ({
    page,
    seededUser,
  }) => {
    let bootstrap: E2EPlatformOrgBootstrap | undefined;
    let extraSpaceId: string | undefined;
    try {
      bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);
      const extraSpace = await bootstrapAdditionalSpaceAdminForUser({
        organizationId: bootstrap.organizationId,
        userId: seededUser.id,
        spaceName: 'E2E Secondary Space',
        slugPrefix: 'spc-secondary',
      });
      extraSpaceId = extraSpace.spaceId;

      await loginViaUi(
        page,
        {
          email: seededUser.email,
          password: seededUser.password,
        },
        '/platform/organizations'
      );

      await page.goto(
        `/platform/organizations/${bootstrap.organizationId}/settings`
      );

      const organizationFeatureCheckbox = page.getByTestId(
        'organization-feature-flag-organization-settings'
      );
      await expect(organizationFeatureCheckbox).toBeVisible({
        timeout: 15_000,
      });
      await expect(organizationFeatureCheckbox).toHaveAttribute(
        'data-current-value',
        'false'
      );
      await expect(
        page.getByTestId('organization-platform-locale')
      ).toHaveCount(0);

      await organizationFeatureCheckbox.click();
      await page
        .getByTestId('organization-feature-flag-organization-settings-submit')
        .click();
      await page.reload();
      await expect(organizationFeatureCheckbox).toHaveAttribute(
        'data-current-value',
        'true'
      );

      const extraSpaceCheckbox = page.getByTestId(
        `organization-feature-flag-space-${extraSpaceId}`
      );
      await expect(extraSpaceCheckbox).toHaveAttribute(
        'data-current-value',
        'false'
      );
      await extraSpaceCheckbox.click();
      await page
        .getByTestId(`organization-feature-flag-space-${extraSpaceId}-submit`)
        .click();
      await page.reload();
      await expect(extraSpaceCheckbox).toHaveAttribute(
        'data-current-value',
        'true'
      );

      const localeSelect = page.getByTestId('organization-platform-locale');
      await expect(localeSelect).toBeVisible({ timeout: 15_000 });

      await selectShadcnOption({
        page,
        testId: 'organization-platform-locale',
        optionValue: 'es',
      });
      await page.getByTestId('organization-platform-locale-submit').click();
      await expect(
        page.getByTestId('organization-platform-locale-submit')
      ).toBeEnabled();

      await page.reload();
      await expect(localeSelect).toHaveAttribute('data-current-value', 'es');

      await selectShadcnOption({
        page,
        testId: 'organization-platform-locale',
        optionValue: '',
      });
      await page.getByTestId('organization-platform-locale-submit').click();
      await expect(
        page.getByTestId('organization-platform-locale-submit')
      ).toBeEnabled();

      await page.reload();
      await expect(
        page.getByTestId('organization-platform-locale')
      ).toHaveAttribute('data-current-value', '');
    } finally {
      if (bootstrap) {
        await deleteOrganizationCascade(bootstrap.organizationId);
      }
    }
  });
});
