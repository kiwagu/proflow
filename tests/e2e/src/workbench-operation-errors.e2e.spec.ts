import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

/**
 * A failed operation reaches the user, end to end.
 *
 * The failure provoked here is a real one the app refuses by design: a
 * markdown file that is not UTF-8 cannot become a document, and the
 * explorer reports it instead of writing a corrupted one. What the case
 * pins down is that the report is on the page — not in the console — and
 * that it blocks nothing: the explorer keeps working with the notice up,
 * and dismissing it leaves no trace.
 */
test.describe('Workbench operation errors', () => {
  test('@smoke a refused import is shown to the user without blocking the page', async ({
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

      // Six Windows-1251 bytes of a Cyrillic word: not valid UTF-8.
      await page.getByTestId('file-input').setInputFiles([
        {
          name: 'broken.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
        },
      ]);

      // Other notices may be up (a browser that grants no persistent
      // storage is told so at start-up); the import's is the one that
      // names the file.
      const notice = page
        .getByTestId('operation-error')
        .filter({ hasText: 'broken.md' });
      await expect(notice).toBeVisible();
      await expect(
        page.getByTestId('file-row').filter({ hasText: 'broken' })
      ).toHaveCount(0);

      // Nothing is blocked: the explorer still creates and opens a document
      // while the notice is up, and the keyboard reaches the editor.
      await page.getByTestId('new-document').click();
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor.click();
      await editor.pressSequentially('typed with the notice up');
      await expect(editor).toContainText('typed with the notice up');
      await expect(notice).toBeVisible();

      await notice.getByRole('button', { name: 'Dismiss' }).click();
      await expect(notice).toHaveCount(0);
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
