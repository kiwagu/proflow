import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Log in via the platform login form and navigate to the target page.
 *
 * Wait for the app-driven post-login navigation instead of forcing our own
 * `page.goto()`, which can interrupt the async sign-in flow before the SSR
 * session cookie is fully established.
 *
 * Some valid authenticated landings, like `/platform/onboarding`, are an
 * intermediate state for users without org bootstrap yet.
 */
export async function loginViaUi(
  page: Page,
  credentials: {
    email: string;
    password: string;
  },
  targetPath = '/platform/profile'
): Promise<void> {
  const loginPath = `/platform?next=${encodeURIComponent(targetPath)}`;
  await page.goto(loginPath);
  await expect(page.getByTestId('auth-login-form')).toBeVisible();
  await page.getByTestId('auth-login-email').fill(credentials.email);
  await page.getByTestId('auth-login-password').fill(credentials.password);
  await page.getByTestId('auth-login-submit').click();

  const loginError = page.getByTestId('auth-login-error');
  const loginForm = page.getByTestId('auth-login-form');
  const escapedTargetPath = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetRe = new RegExp(escapedTargetPath);
  const authenticatedLandingRe =
    /\/platform\/(onboarding|profile|space-settings|organizations)(?:\/|$)/;
  const postLoginRe = new RegExp(
    `(?:${escapedTargetPath})|(?:${authenticatedLandingRe.source})`
  );

  await expect(async () => {
    if (await loginError.isVisible()) {
      const message = (await loginError.textContent())?.trim();
      throw new Error(`Login failed: ${message ?? 'unknown error'}`);
    }

    if (await loginForm.isVisible()) {
      throw new Error('Waiting for post-login redirect.');
    }

    await expect(page).toHaveURL(postLoginRe, { timeout: 1_000 });
  }).toPass({ timeout: 45_000, intervals: [200, 500, 1_000, 2_000] });

  await expect(page).toHaveURL(targetRe, { timeout: 15_000 });
}
