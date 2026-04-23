import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
  type E2EPlatformOrgBootstrap,
} from './helpers/platform-org-bootstrap.js';
import {
  bootstrapPlatformSuperAdminForUser,
  listPlatformSuperAdminsForE2E,
  type E2EPlatformSuperAdminGrant,
} from './helpers/platform-super-admin.js';
import {
  resetGlobalOrganizationSettingsFeatureFlag,
  resetGlobalPlatformLocale,
} from './helpers/runtime-settings.js';
import { selectShadcnOption } from './helpers/select.js';
import { cleanupTestUser, seedTestUser } from './helpers/test-user.js';

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

test.describe('platform super admin management', () => {
  test('@smoke non-super-admin user is redirected away from /ops', async ({
    page,
    seededUser,
  }) => {
    let bootstrap: E2EPlatformOrgBootstrap | undefined;

    try {
      bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);

      await loginViaUi(
        page,
        {
          email: seededUser.email,
          password: seededUser.password,
        },
        '/platform/profile'
      );

      await page.goto('/platform/ops');

      await expect(page).toHaveURL(/\/platform\/profile(?:\?.*)?$/);
      await expect(
        page.getByTestId('platform-super-admin-management')
      ).toHaveCount(0);
    } finally {
      if (bootstrap) {
        await deleteOrganizationCascade(bootstrap.organizationId);
      }
    }
  });

  test('@full super-admin can create a global system role from /ops', async ({
    page,
    seededUser,
  }) => {
    await bootstrapPlatformSuperAdminForUser(seededUser.id);

    await loginViaUi(
      page,
      {
        email: seededUser.email,
        password: seededUser.password,
      },
      '/platform/ops'
    );

    const createCard = page.getByTestId('global-system-role-catalog-create');
    await expect(createCard).toBeVisible({ timeout: 30_000 });

    const suffix = `${Date.now()}${randomToken()}`;
    const roleKey = `e2e_global_${suffix}`;
    const roleLabel = `E2E Global ${suffix}`;

    await createCard.locator('#key').fill(roleKey);
    await createCard.locator('#label').fill(roleLabel);
    await createCard
      .locator('#description')
      .fill('E2E contract test role for super-admin catalog.');

    await createCard
      .locator('[id^="create-global-role-permission-"]')
      .first()
      .click();
    await createCard.locator('#create-global-role-confirm').click();
    await createCard
      .getByRole('button', { name: /create global role/i })
      .click();

    await expect(
      page.getByTestId('global-system-role-catalog-list')
    ).toContainText(roleLabel, {
      timeout: 20_000,
    });
  });

  test('@full platform super admin can grant and revoke another platform super admin from /ops', async ({
    page,
    seededUser,
  }) => {
    const secondaryUser = await seedTestUser();
    let revokedExistingSuperAdmin: E2EPlatformSuperAdminGrant | null = null;

    try {
      await bootstrapPlatformSuperAdminForUser(seededUser.id);

      await loginViaUi(
        page,
        {
          email: seededUser.email,
          password: seededUser.password,
        },
        '/platform/ops'
      );

      await expect(
        page.getByTestId('platform-super-admin-management')
      ).toBeVisible({ timeout: 30_000 });

      const currentSuperAdmins = await listPlatformSuperAdminsForE2E();
      if (currentSuperAdmins.length >= 3) {
        const revokeCandidate = currentSuperAdmins.find(
          (grant) => grant.userId !== seededUser.id
        );

        if (!revokeCandidate) {
          throw new Error(
            'Expected a revocable platform super admin to free a grant slot.'
          );
        }

        revokedExistingSuperAdmin = revokeCandidate;

        const revokeCandidateRow = page.getByTestId(
          `platform-super-admin-row-${revokeCandidate.userId}`
        );
        await expect(revokeCandidateRow).toBeVisible({ timeout: 15_000 });

        await page
          .getByTestId(
            `platform-super-admin-revoke-toggle-${revokeCandidate.userId}`
          )
          .click();
        await page
          .getByTestId(
            `platform-super-admin-revoke-reason-${revokeCandidate.userId}`
          )
          .fill(
            'Temporarily free a slot for e2e platform super-admin grant coverage.'
          );
        await page
          .getByTestId(
            `platform-super-admin-revoke-confirm-${revokeCandidate.userId}`
          )
          .click();

        const revokeCandidateConfirm = page.getByTestId(
          `platform-super-admin-revoke-confirm-${revokeCandidate.userId}`
        );
        await expect(revokeCandidateConfirm).toHaveAttribute(
          'data-state',
          'checked'
        );

        const revokeCandidateSubmit = page.getByTestId(
          `platform-super-admin-revoke-submit-${revokeCandidate.userId}`
        );
        await expect(revokeCandidateSubmit).toBeEnabled();
        await revokeCandidateSubmit.click();
        await expect(revokeCandidateRow).toHaveCount(0, { timeout: 15_000 });
      }

      await page
        .getByTestId('platform-super-admin-grant-email')
        .fill(secondaryUser.email);
      await page
        .getByTestId('platform-super-admin-grant-reason')
        .fill('Grant temporary operator coverage for e2e smoke.');
      await page.getByTestId('platform-super-admin-grant-confirm').click();

      const grantConfirm = page.getByTestId(
        'platform-super-admin-grant-confirm'
      );
      await expect(grantConfirm).toHaveAttribute('data-state', 'checked');

      const grantSubmit = page.getByTestId('platform-super-admin-grant-submit');
      await expect(grantSubmit).toBeEnabled();
      await grantSubmit.click();

      const secondaryRow = page.getByTestId(
        `platform-super-admin-row-${secondaryUser.id}`
      );
      await expect(secondaryRow).toBeVisible({ timeout: 15_000 });

      await page
        .getByTestId(`platform-super-admin-revoke-toggle-${secondaryUser.id}`)
        .click();
      await page
        .getByTestId(`platform-super-admin-revoke-reason-${secondaryUser.id}`)
        .fill('Remove temporary operator coverage after e2e smoke.');
      await page
        .getByTestId(`platform-super-admin-revoke-confirm-${secondaryUser.id}`)
        .click();

      const revokeConfirm = page.getByTestId(
        `platform-super-admin-revoke-confirm-${secondaryUser.id}`
      );
      await expect(revokeConfirm).toHaveAttribute('data-state', 'checked');

      const revokeSubmit = page.getByTestId(
        `platform-super-admin-revoke-submit-${secondaryUser.id}`
      );
      await expect(revokeSubmit).toBeEnabled();
      await page
        .getByTestId(`platform-super-admin-revoke-submit-${secondaryUser.id}`)
        .click();

      await expect(secondaryRow).toHaveCount(0, { timeout: 15_000 });
    } finally {
      try {
        await cleanupTestUser(secondaryUser.id);
      } finally {
        if (revokedExistingSuperAdmin) {
          await bootstrapPlatformSuperAdminForUser(
            revokedExistingSuperAdmin.userId,
            revokedExistingSuperAdmin.reason ??
              'Restore platform super admin after e2e capacity cleanup.'
          );
        }
      }
    }
  });

  test('@full super-admin global feature flag acts as a template for newly created organizations', async ({
    page,
    seededUser,
  }) => {
    let bootstrapBefore: E2EPlatformOrgBootstrap | undefined;
    let bootstrapAfter: E2EPlatformOrgBootstrap | undefined;

    try {
      await resetGlobalOrganizationSettingsFeatureFlag();
      bootstrapBefore = await bootstrapOrgSpaceAdminForUser(seededUser.id);
      await bootstrapPlatformSuperAdminForUser(seededUser.id);

      await loginViaUi(
        page,
        {
          email: seededUser.email,
          password: seededUser.password,
        },
        '/platform/ops'
      );

      const organizationSettingsFlag = page.getByTestId(
        'global-platform-feature-flag-organization-settings'
      );
      await expect(organizationSettingsFlag).toBeVisible({ timeout: 30_000 });

      await organizationSettingsFlag.click();
      await page
        .getByTestId(
          'global-platform-feature-flag-organization-settings-submit'
        )
        .click();
      await expect(
        page.getByTestId(
          'global-platform-feature-flag-organization-settings-submit'
        )
      ).toBeEnabled();

      bootstrapAfter = await bootstrapOrgSpaceAdminForUser(seededUser.id);

      await page.goto(
        `/platform/organizations/${bootstrapBefore.organizationId}/settings`
      );
      await expect(
        page.getByTestId('organization-feature-flag-organization-settings')
      ).toHaveAttribute('data-current-value', 'false');

      await page.goto(
        `/platform/organizations/${bootstrapAfter.organizationId}/settings`
      );
      await expect(
        page.getByTestId('organization-feature-flag-organization-settings')
      ).toHaveAttribute('data-current-value', 'true');
    } finally {
      await resetGlobalOrganizationSettingsFeatureFlag();
      if (bootstrapBefore) {
        await deleteOrganizationCascade(bootstrapBefore.organizationId);
      }
      if (bootstrapAfter) {
        await deleteOrganizationCascade(bootstrapAfter.organizationId);
      }
    }
  });

  test('@full super-admin can update global platform locale from /ops and public login uses it', async ({
    page,
    seededUser,
  }) => {
    try {
      await bootstrapPlatformSuperAdminForUser(seededUser.id);

      await loginViaUi(
        page,
        {
          email: seededUser.email,
          password: seededUser.password,
        },
        '/platform/ops'
      );

      const localeSelect = page.getByTestId('global-platform-locale');
      await expect(localeSelect).toBeVisible({ timeout: 30_000 });

      await selectShadcnOption({
        page,
        testId: 'global-platform-locale',
        optionValue: 'es',
      });
      await page.getByTestId('global-platform-locale-submit').click();
      await expect(
        page.getByTestId('global-platform-locale-submit')
      ).toBeEnabled();

      await page.getByTestId('auth-user-menu-trigger').click();
      await expect(page.getByTestId('auth-logout-button')).toBeVisible();
      await page.getByTestId('auth-logout-button').click();
      await expect(page).toHaveURL(/\/platform(?:\?.*)?$/);
      await expect(page.getByTestId('auth-login-title')).toHaveText(
        'Iniciar sesion'
      );
      await expect(page.getByTestId('auth-login-submit')).toHaveText('Entrar');
    } finally {
      await resetGlobalPlatformLocale();
    }
  });
});
