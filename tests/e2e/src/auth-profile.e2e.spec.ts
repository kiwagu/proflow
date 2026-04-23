import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import { expectPlatformProfileReady } from './helpers/platform-profile.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
  type E2EPlatformOrgBootstrap,
} from './helpers/platform-org-bootstrap.js';
import { selectShadcnOption } from './helpers/select.js';

test.describe('platform auth and profile flow', () => {
  test('@smoke guest is redirected from protected route to login form', async ({
    page,
  }) => {
    await page.goto('/platform/profile');

    await expect(page).toHaveURL(/\/platform(?:\/|\?|$)/);
    await expect(page.getByTestId('auth-login-form')).toBeVisible();
  });

  test('@smoke user can login and persist profile edit', async ({
    page,
    seededUser,
  }) => {
    // Profile page requires org+space; bootstrap before login so the
    // server-side gate redirects to /profile instead of /onboarding.
    let bootstrap: E2EPlatformOrgBootstrap | undefined;
    try {
      bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);

      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });
      await expectPlatformProfileReady(page);
      await expect(page.getByTestId('profile-email')).toHaveValue(/.+@/, {
        timeout: 15_000,
      });

      const displayNameInput = page.getByTestId('profile-display-name');
      const bioInput = page.getByTestId('profile-bio');
      const previousDisplayName = await displayNameInput.inputValue();
      const previousBio = await bioInput.inputValue();
      const runId = `e2e-${Date.now()}`;
      const nextDisplayName = `Stagehand ${runId}`;
      const nextBio = `Updated by e2e test ${runId}`;

      await displayNameInput.clear();
      await displayNameInput.pressSequentially(nextDisplayName);
      await expect(displayNameInput).toHaveValue(nextDisplayName);

      await bioInput.clear();
      await bioInput.pressSequentially(nextBio);
      await expect(bioInput).toHaveValue(nextBio);

      await page.getByTestId('profile-save-submit').click();
      await expect(page.getByTestId('profile-save-success')).toBeVisible();

      await page.reload();
      await expectPlatformProfileReady(page);
      await expect(page.getByTestId('profile-email')).toHaveValue(/.+@/, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('profile-display-name')).toHaveValue(
        nextDisplayName
      );
      await expect(page.getByTestId('profile-bio')).toHaveValue(nextBio);

      // Restore previous profile values to keep e2e runs isolated.
      const restoreDn = page.getByTestId('profile-display-name');
      const restoreBio = page.getByTestId('profile-bio');
      await restoreDn.clear();
      if (previousDisplayName) {
        await restoreDn.pressSequentially(previousDisplayName);
      }
      await restoreBio.clear();
      if (previousBio) {
        await restoreBio.pressSequentially(previousBio);
      }
      await page.getByTestId('profile-save-submit').click();
      await expect(page.getByTestId('profile-save-success')).toBeVisible();
    } finally {
      if (bootstrap) await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });

  test('@full user can persist profile language override', async ({
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

      await expectPlatformProfileReady(page);

      const localeSelect = page.getByTestId('profile-platform-locale');
      const localeSuccess = page.getByTestId('profile-platform-locale-success');
      await expect(localeSelect).toBeVisible({ timeout: 15_000 });

      await selectShadcnOption({
        page,
        testId: 'profile-platform-locale',
        optionValue: 'es',
      });
      await expect(localeSuccess).toBeHidden();
      await page.getByTestId('profile-platform-locale-submit').click();
      await expect(localeSuccess).toBeVisible();

      await page.reload();
      await expectPlatformProfileReady(page);
      await expect(localeSelect).toHaveAttribute('data-current-value', 'es');

      await selectShadcnOption({
        page,
        testId: 'profile-platform-locale',
        optionValue: '',
      });
      await expect(localeSuccess).toBeHidden();
      await page.getByTestId('profile-platform-locale-submit').click();
      await expect(localeSuccess).toBeVisible();

      await page.reload();
      await expectPlatformProfileReady(page);
      await expect(page.getByTestId('profile-platform-locale')).toHaveAttribute(
        'data-current-value',
        ''
      );
    } finally {
      if (bootstrap) await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
  test('@smoke user can upload avatar', async ({ page, seededUser }) => {
    let bootstrap: E2EPlatformOrgBootstrap | undefined;
    try {
      bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);

      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });

      await expectPlatformProfileReady(page);

      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.getByTestId('image-upload-dropzone').click();
      const fileChooser = await fileChooserPromise;

      // Create a dummy 1x1 png image
      const dummyImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );

      await fileChooser.setFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: dummyImageBuffer,
      });

      // Wait for the preview image to be updated to the final supabase url
      await expect(page.locator('img[alt="Avatar preview"]')).toHaveAttribute(
        'src',
        /\/storage\/v1\/object\/public\//
      );

      // Save profile
      await page.getByTestId('profile-save-submit').click();
      await expect(page.getByTestId('profile-save-success')).toBeVisible();

      // Reload to confirm it persists
      await page.reload();
      await expectPlatformProfileReady(page);

      // Avatar image should be loaded from supabase url (or the uploaded url)
      // Since it's stored in the database, it shouldn't be empty
      await expect(
        page.locator('img[alt="Avatar preview"]')
      ).not.toHaveAttribute('src', '');

      // Remove the avatar and persist the clear.
      await page.getByTestId('image-upload-remove').click();
      await expect(page.getByTestId('image-upload-remove')).toHaveCount(0);

      await page.getByTestId('profile-save-submit').click();
      await expect(page.getByTestId('profile-save-success')).toBeVisible();

      await page.reload();
      await expectPlatformProfileReady(page);
      await expect(page.getByTestId('image-upload-remove')).toHaveCount(0);
    } finally {
      if (bootstrap) await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
});
