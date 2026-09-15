import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

/**
 * A document's history, end to end over the real local database.
 *
 * Versions are not written by the panel: the editor marks one after a pause
 * in typing, and the position it marks lives in the document's CRDT. So the
 * only honest way to prove the panel shows the document's actual past is to
 * let the app produce two versions by typing, and then assert that the older
 * one previews WITHOUT the later text — a unit can pair a list with a
 * callback, but not that the stored history is the one being read.
 *
 * Restoring is asserted the same way, on the two facts that distinguish a
 * real restore from a preview: the editor afterwards shows the earlier text,
 * and the history is LONGER, because a restore appends rather than truncates.
 *
 * The waits are the editor's own idle interval; they are what makes a version
 * exist at all, so they are polled on the version count rather than slept
 * through blindly.
 */
test.describe('Workbench document history', () => {
  test.describe.configure({ timeout: 300_000 });

  test('@smoke the history panel previews and restores an earlier version', async ({
    page,
    seededUser,
  }) => {
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
      await editor.pressSequentially('v1');
      await expect(page.getByTestId('save-state')).toContainText(/saved/i);

      // The first version exists only once the editor's idle interval has
      // passed with no further keystroke.
      const trigger = page.getByTestId('history-panel-trigger');
      await expect(trigger).toBeVisible();
      await trigger.click();
      const rows = page.getByTestId('history-version');
      await expect(rows).toHaveCount(1, { timeout: 90_000 });

      // Typing again with the panel open: the second version is marked from
      // the state that includes it.
      await editor.click();
      await editor.pressSequentially(' v2');
      await expect(page.getByTestId('save-state')).toContainText(/saved/i);
      await expect(rows).toHaveCount(2, { timeout: 90_000 });

      // Closing and reopening by the SHORTCUT, because the binding is the
      // part that can silently never fire. Focus is in the editor, which the
      // registry deliberately yields to, so the panel is closed by its
      // control first and the shortcut is pressed with focus off the text.
      await trigger.click();
      await expect(page.getByTestId('history-panel')).toHaveCount(0);
      await trigger.focus();
      await page.keyboard.press('Control+Shift+H');
      await expect(page.getByTestId('history-panel')).toBeVisible();
      await expect(rows).toHaveCount(2);

      // The OLDER version is the last row; its preview is the document as it
      // was before the second edit.
      await rows.last().click();
      const preview = page.getByTestId('history-preview');
      await expect(preview).toBeVisible();
      await expect(preview).toContainText('v1');
      await expect(preview).not.toContainText('v2');

      await page.getByTestId('history-restore').click();

      // The document itself went back, and the history grew by the restore
      // rather than losing what came after it.
      await expect(page.locator('[contenteditable="true"]').first()).toHaveText(
        'v1',
        { timeout: 60_000 }
      );
      await expect(rows).toHaveCount(3, { timeout: 60_000 });
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
