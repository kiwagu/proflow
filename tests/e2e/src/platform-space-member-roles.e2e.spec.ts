import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  bootstrapSpaceAdminOnlyForUser,
  deleteOrganizationCascade,
  setOrganizationSettingsFeatureRollout,
} from './helpers/platform-org-bootstrap.js';

test.describe('platform space member roles', () => {
  test('@smoke org admin can update member role from space settings section', async ({
    page,
    seededUser,
  }) => {
    const bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    try {
      await loginViaUi(
        page,
        {
          email: seededUser.email,
          password: seededUser.password,
        },
        '/platform/space-settings'
      );

      await page.goto('/platform/space-settings');

      const memberRolesSection = page.getByTestId(
        `space-member-roles-${bootstrap.spaceId}`
      );
      await expect(memberRolesSection).toBeVisible({ timeout: 30_000 });

      const delegationPolicySection = page.getByTestId(
        `space-delegation-policy-${bootstrap.spaceId}`
      );
      await expect(delegationPolicySection).toBeVisible({ timeout: 15_000 });
      await expect(
        delegationPolicySection.getByTestId(
          'space-delegation-policy-row-space-users-create'
        )
      ).toBeVisible();

      const memberRow = memberRolesSection.getByTestId(
        `space-member-role-row-${seededUser.id}`
      );
      await expect(memberRow).toBeVisible({ timeout: 15_000 });

      const roleSelect = memberRolesSection.getByTestId(
        `space-member-role-select-${seededUser.id}`
      );
      await expect(roleSelect).toBeVisible();

      const saveButton = memberRolesSection.getByTestId(
        `space-member-role-save-${seededUser.id}`
      );
      await expect(saveButton).toBeDisabled();

      const currentRoleKey = await roleSelect.inputValue();
      const roleOptions = await roleSelect.evaluate((element) =>
        Array.from((element as HTMLSelectElement).options).map(
          (option) => option.value
        )
      );

      const nextRoleKey = roleOptions.find(
        (roleKey) => roleKey !== currentRoleKey
      );
      expect(nextRoleKey).toBeTruthy();

      await roleSelect.selectOption(nextRoleKey!);
      await expect(saveButton).toBeEnabled();

      await saveButton.click();

      await expect.poll(async () => roleSelect.inputValue()).toBe(nextRoleKey);
      await expect(saveButton).toBeDisabled();
    } finally {
      await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });

  test('@smoke space admin is denied role catalog controls in UI', async ({
    page,
    seededUser,
  }) => {
    const bootstrap = await bootstrapSpaceAdminOnlyForUser(seededUser.id);
    try {
      await setOrganizationSettingsFeatureRollout({
        organizationId: bootstrap.organizationId,
        spaceId: bootstrap.spaceId,
        userId: seededUser.id,
        organizationEnabled: false,
        spaceEnabled: true,
      });

      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });

      await page.goto('/platform/space-settings');

      const memberRolesSection = page.getByTestId(
        `space-member-roles-${bootstrap.spaceId}`
      );
      await expect(memberRolesSection).toBeVisible({ timeout: 30_000 });

      const delegationPolicySection = page.getByTestId(
        `space-delegation-policy-${bootstrap.spaceId}`
      );
      await expect(delegationPolicySection).toBeVisible({ timeout: 15_000 });
      await expect(
        delegationPolicySection.getByTestId(
          'space-delegation-policy-row-space-users-delete'
        )
      ).toBeVisible();

      const featureVisibilitySection = page.getByTestId(
        `space-feature-visibility-${bootstrap.spaceId}`
      );
      await expect(featureVisibilitySection).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByTestId(
          `space-feature-visibility-effective-${bootstrap.spaceId}`
        )
      ).toContainText('Disabled');
      await expect(
        page.getByTestId(
          `space-feature-visibility-organization-gate-${bootstrap.spaceId}`
        )
      ).toContainText('Disabled');
      await expect(
        page.getByTestId(
          `space-feature-visibility-space-activation-${bootstrap.spaceId}`
        )
      ).toContainText('Enabled');
      await expect(
        page.getByTestId(`space-feature-visibility-source-${bootstrap.spaceId}`)
      ).toContainText('Organization disabled overrides space activation');

      await expect(
        page.getByTestId(
          `organization-role-catalog-${bootstrap.organizationId}`
        )
      ).toHaveCount(0);
    } finally {
      await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
});
