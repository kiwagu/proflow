import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/login';
import { seedTestUser, cleanupTestUser, testUser } from '../helpers/seedUser';

test.describe('Admin Panel', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await seedTestUser();

    const context = await browser.newContext();
    page = await context.newPage();

    await login({ page, user: testUser });
  });

  test.afterAll(async () => {
    await cleanupTestUser();
  });

  test('can navigate to dashboard', async () => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/author\/admin\/?$/);
    const dashboardArtifact = page.locator('span[title="Dashboard"]').first();
    await expect(dashboardArtifact).toBeVisible();
  });

  test('can navigate to list view', async () => {
    await page.goto('/admin/collections/users');
    await expect(page).toHaveURL(/\/author\/admin\/collections\/users\/?$/);
    const listViewArtifact = page.locator('h1', { hasText: 'Users' }).first();
    await expect(listViewArtifact).toBeVisible();
  });

  test('shows centralized-management dialog when saving user edits', async () => {
    await page.goto('/admin/collections/users');
    await page.getByRole('link', { name: testUser.email, exact: true }).click();
    await expect(page).toHaveURL(
      /\/author\/admin\/collections\/users\/[^/]+\/?$/
    );
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toBeEditable();
    await emailInput.fill(testUser.email.replace('@', '+e2e@'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Platform/i);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test('users create route is blocked (centralized auth)', async () => {
    await page.goto('/admin/collections/users/create');
    await expect(page).not.toHaveURL(/\/users\/create\/?$/);
  });
});
