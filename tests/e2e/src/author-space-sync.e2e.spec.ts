import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapAdditionalSpaceAdminForUser,
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
  type E2EPlatformOrgBootstrap,
  type E2EPlatformSpaceBootstrap,
} from './helpers/platform-org-bootstrap.js';

async function selectPlatformSpace(page: Page, spaceId: string) {
  await page.getByTestId('platform-space-switcher-trigger').click();
  await page.getByTestId(`platform-space-switcher-option-${spaceId}`).click();
}

async function expectAuthorActiveSpaceId(
  page: Page,
  spaceId: string
): Promise<void> {
  await expect(page.getByTestId('author-active-space-id')).toHaveText(spaceId, {
    timeout: 5_000,
  });
}

async function expectCanonicalActiveSpaceCookie(
  page: Page,
  spaceId: string
): Promise<void> {
  await expect
    .poll(async () => {
      const cookies = await page.context().cookies(page.url());
      return (
        cookies.find((cookie) => cookie.name === 'pf_active_space_id')?.value ??
        null
      );
    })
    .toBe(spaceId);
}

async function expectAuthorTenantCookie(
  page: Page,
  spaceId: string
): Promise<void> {
  await expect
    .poll(async () => {
      const cookies = await page.context().cookies(page.url());
      return (
        cookies.find((cookie) => cookie.name === 'payload-tenant')?.value ??
        null
      );
    })
    .toBe(spaceId);
}

async function setAuthorActiveSpace(
  page: Page,
  spaceId: string
): Promise<void> {
  const result = await page.evaluate(async (nextSpaceId) => {
    const response = await fetch('/author/api/auth/active-space', {
      body: JSON.stringify({ spaceId: nextSpaceId }),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  }, spaceId);

  expect(
    result.ok,
    `author active-space switch failed: ${result.status} ${result.body}`
  ).toBe(true);

  await expectCanonicalActiveSpaceCookie(page, spaceId);
  await expectAuthorTenantCookie(page, spaceId);
  await page.goto('/author/admin', { timeout: 60_000 });
  await expect(page).toHaveURL(/\/author\/admin/i, { timeout: 10_000 });
  await expectAuthorActiveSpaceId(page, spaceId);
}

async function expectAuthorAdminReadyForSpace(
  page: Page,
  spaceId: string
): Promise<void> {
  await expect(async () => {
    await page.goto('/author/admin', { timeout: 60_000 });
    await expect(page).toHaveURL(/\/author\/admin/i, { timeout: 10_000 });
    await expectAuthorTenantCookie(page, spaceId);
    await expectAuthorActiveSpaceId(page, spaceId);
  }).toPass({ timeout: 60_000, intervals: [500, 1_000, 2_000, 5_000] });
}

test.describe('author active space sync', () => {
  test.describe.configure({ timeout: 120_000 });

  test('@full author tenant selector stays synced with platform active space', async ({
    page,
    seededUser,
  }) => {
    let bootstrap: E2EPlatformOrgBootstrap | undefined;
    let secondSpace: E2EPlatformSpaceBootstrap | undefined;

    try {
      bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);
      const primarySpaceId = bootstrap.spaceId;
      secondSpace = await bootstrapAdditionalSpaceAdminForUser({
        organizationId: bootstrap.organizationId,
        spaceName: 'Second Space',
        userId: seededUser.id,
      });
      const secondSpaceId = secondSpace.spaceId;

      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });

      // Ensure a deterministic baseline: with multiple memberships, explicitly
      // select the expected active space in Platform before asserting in Author.
      await page.goto('/platform/profile', { timeout: 60_000 });
      await selectPlatformSpace(page, primarySpaceId);
      await expect(page.getByTestId('profile-active-space-name')).toContainText(
        'E2E Space'
      );
      await expectCanonicalActiveSpaceCookie(page, primarySpaceId);

      await expectAuthorAdminReadyForSpace(page, primarySpaceId);

      await page.goto('/platform/profile', { timeout: 60_000 });
      await selectPlatformSpace(page, secondSpaceId);
      await expect(page.getByTestId('profile-active-space-name')).toContainText(
        'Second Space'
      );
      await expectCanonicalActiveSpaceCookie(page, secondSpaceId);

      await expectAuthorAdminReadyForSpace(page, secondSpaceId);

      await setAuthorActiveSpace(page, primarySpaceId);
      await expectAuthorAdminReadyForSpace(page, primarySpaceId);

      await expect(async () => {
        await page.goto('/platform/profile', { timeout: 60_000 });
        await expect(
          page.getByTestId('profile-active-space-name')
        ).toContainText('E2E Space', { timeout: 5_000 });
      }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
    } finally {
      if (bootstrap) await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
});
