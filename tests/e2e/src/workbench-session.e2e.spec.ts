import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import { seedTestUser, cleanupTestUser } from './helpers/test-user.js';
import {
  bootstrapOrgSpaceAdminForUser,
  bootstrapAdditionalSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

test.describe('Workbench session', () => {
  test.describe.configure({ timeout: 180_000 });

  test('@smoke guest is redirected before local storage opens', async ({
    page,
  }) => {
    await page.goto('/author/');
    await expect(page.getByTestId('auth-login-form')).toBeVisible();
    await expect(page).toHaveURL(/\/platform\?next=/);
    const result = await page.request.get('/platform/api/workbench/session');
    expect(result.status()).toBe(401);
    expect(result.headers()['cache-control']).toContain('no-store');
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length)
    ).toBe(0);
  });

  test('@smoke signed-in user without a space gets a Platform handoff', async ({
    page,
    seededUser,
  }) => {
    await loginViaUi(page, seededUser, '/author');
    await expect(page.getByTestId('workbench-no-space')).toBeVisible();
    await expect(page.getByTestId('file-explorer')).toHaveCount(0);
  });

  test('@smoke login opens the editor and logout removes access', async ({
    page,
    seededUser,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    try {
      await loginViaUi(page, seededUser, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByTestId('workbench-user')).toHaveText(
        seededUser.email
      );
      await page.getByTestId('new-document').click();
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible();
      await editor.click();
      await editor.pressSequentially('Workbench session document');
      await expect(page.getByTestId('save-state')).toContainText(/saved/i);
      await page.context().setOffline(true);
      await editor.pressSequentially(' offline');
      await expect(
        page.getByText('Offline. Changes are saved on this device.')
      ).toBeVisible({ timeout: 35_000 });
      await expect(editor).toBeVisible();
      await expect(page.getByTestId('save-state')).toContainText(/saved/i);
      await page.context().setOffline(false);
      await page.reload();
      await expect(
        page.getByTestId('files-section').getByTestId('file-row').first()
      ).toBeVisible({
        timeout: 120_000,
      });
      await page
        .getByTestId('files-section')
        .getByTestId('file-row')
        .first()
        .click();
      await expect(
        page.locator('[contenteditable="true"]').first()
      ).toContainText('Workbench session document offline');
      await page.getByTestId('workbench-signout').click();
      await page.goto('/author/');
      await expect(page.getByTestId('auth-login-form')).toBeVisible();
      expect(pageErrors).toEqual([]);
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });

  test('@full switching accounts in one browser does not expose the previous local documents', async ({
    page,
    seededUser,
  }) => {
    const other = await seedTestUser();
    const firstOrg = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const secondOrg = await bootstrapOrgSpaceAdminForUser(other.id);
    try {
      await loginViaUi(page, seededUser, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await page.getByTestId('new-document').click();
      await expect(
        page.getByTestId('files-section').getByTestId('file-row')
      ).toHaveCount(1);
      await page.getByTestId('workbench-signout').click();
      await loginViaUi(page, other, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByTestId('workbench-user')).toHaveText(other.email);
      await expect(
        page.getByTestId('files-section').getByTestId('file-row')
      ).toHaveCount(0);
      await page.getByTestId('workbench-signout').click();
      await loginViaUi(page, seededUser, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await expect(
        page.getByTestId('files-section').getByTestId('file-row')
      ).toHaveCount(1);
    } finally {
      await deleteOrganizationCascade(secondOrg.organizationId);
      await deleteOrganizationCascade(firstOrg.organizationId);
      await cleanupTestUser(other.id);
    }
  });

  test('@full Platform space switch and logout invalidate an already open Workbench', async ({
    page,
    seededUser,
  }) => {
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const otherSpace = await bootstrapAdditionalSpaceAdminForUser({
      organizationId: org.organizationId,
      userId: seededUser.id,
      spaceName: 'E2E Second Space',
    });
    try {
      await loginViaUi(page, seededUser, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await page.getByTestId('new-document').click();
      await expect(
        page.getByTestId('files-section').getByTestId('file-row')
      ).toHaveCount(1);
      const platform = await page.context().newPage();
      await platform.goto('/platform/profile');
      await platform.getByTestId('platform-space-switcher-trigger').click();
      await platform
        .getByTestId(`platform-space-switcher-option-${otherSpace.spaceId}`)
        .click();
      await expect
        .poll(async () =>
          (await platform.request.get('/platform/api/workbench/session'))
            .json()
            .then((s) => s.spaceId)
        )
        .toBe(otherSpace.spaceId);
      await page.bringToFront();
      await expect(page.getByTestId('workbench-space')).toHaveText(
        'E2E Second Space',
        { timeout: 120_000 }
      );
      await expect(
        page.getByTestId('files-section').getByTestId('file-row')
      ).toHaveCount(0);
      await platform.bringToFront();
      await platform.goto('/platform/auth/signout');
      await page.bringToFront();
      await expect(page.getByTestId('auth-login-form')).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
