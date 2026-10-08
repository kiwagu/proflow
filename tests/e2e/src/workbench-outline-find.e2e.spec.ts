import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

/**
 * The outline and find & replace over a real document, end to end.
 *
 * Both are judged by the editor: the outline must list the headings the
 * user typed, and a replace must change the text the editor shows — a
 * panel that renders is not the claim, the document that changes is.
 *
 * The shortcuts are pressed on purpose. The outline's is pressed with
 * focus off the text, because the registry yields to typing; find's is
 * pressed INSIDE the editor, because that is the one shortcut that must
 * not yield — reaching for ⌘F mid-sentence is the whole point of it.
 */
test.describe('Workbench outline and find & replace', () => {
  test('@smoke the outline lists the headings and a replace changes the document', async ({
    page,
    seededUser,
  }) => {
    test.setTimeout(180_000);
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    try {
      await loginViaUi(page, seededUser, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });

      await page.getByTestId('new-document').click();
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor.click();
      for (const line of ['# One', '## Two', '## Three']) {
        await editor.pressSequentially(line);
        await page.keyboard.press('Enter');
      }
      await editor.pressSequentially('hello world');
      await expect(editor.locator('h1')).toHaveText('One');

      // The outline, by its control: every heading, in order.
      const outlineTrigger = page.getByTestId('outline-panel-trigger');
      await outlineTrigger.click();
      const outline = page.getByTestId('outline-panel');
      await expect(outline).toBeVisible();
      await expect(outline.getByRole('button')).toHaveText([
        'One',
        'Two',
        'Three',
      ]);

      // And by its shortcut, pressed off the text.
      await outlineTrigger.click();
      await expect(outline).toHaveCount(0);
      await outlineTrigger.focus();
      await page.keyboard.press('Control+Shift+O');
      await expect(page.getByTestId('outline-panel')).toBeVisible();

      // Find & replace from inside the editor.
      await editor.click();
      await page.keyboard.press('Control+F');
      const search = page.getByRole('search');
      await expect(search).toBeVisible();
      await search.getByPlaceholder('Find…').fill('hello');
      await expect(search.getByText('1 of 1')).toBeVisible();
      await search.getByPlaceholder('Replace with…').fill('goodbye');
      await search.getByRole('button', { name: 'Replace all' }).click();
      await expect(editor).toContainText('goodbye world');
      await expect(editor).not.toContainText('hello world');

      // Escape closes the panel and the keyboard is back in the text.
      await search.getByPlaceholder('Find…').press('Escape');
      await expect(page.getByRole('search')).toHaveCount(0);
      await expect(editor).toBeFocused();
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
