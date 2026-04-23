import { expect, type Page } from '@playwright/test';

export async function expectPlatformProfileReady(page: Page): Promise<void> {
  await expect(page.getByTestId('profile-card')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('profile-form')).toHaveAttribute(
    'data-hydrated',
    'true',
    {
      timeout: 15_000,
    }
  );
}
