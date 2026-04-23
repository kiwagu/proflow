import { expect, type Page } from '@playwright/test';

export async function selectShadcnOption(input: {
  page: Page;
  testId: string;
  optionValue: string;
}) {
  const { page, testId, optionValue } = input;
  const optionTestId =
    optionValue.length > 0
      ? `${testId}-option-${optionValue}`
      : `${testId}-option-inherit`;
  const trigger = page.getByTestId(testId);
  const option = page.getByTestId(optionTestId);

  await expect(trigger).toBeVisible({ timeout: 15_000 });

  const openActions = [
    async () => trigger.click(),
    async () => trigger.press('ArrowDown'),
    async () => trigger.press('Enter'),
  ];

  let optionVisible = false;
  for (const open of openActions) {
    await open();

    try {
      await option.waitFor({ state: 'visible', timeout: 3_000 });
      optionVisible = true;
      break;
    } catch {
      // Retry with another open interaction. Radix Select can miss the first
      // pointer click in CI while the trigger is settling after hydration.
    }
  }

  expect(optionVisible).toBe(true);
  await option.click();
}
