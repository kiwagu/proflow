import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

/**
 * Markdown in and out of the workbench, end to end over the real local
 * database and a real browser download.
 *
 * Import is judged by what the EDITOR shows: a `.md` file given to the
 * explorer must open as a document named after the file, with its heading
 * rendered as one — an attachment called `note.md` would prove nothing.
 * Export is judged by the bytes the browser hands back: the portable form,
 * starting with the heading the file came in with.
 */
test.describe('Workbench markdown import and export', () => {
  test('@smoke a markdown file opens as a document and exports as portable markdown', async ({
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

      await page.getByTestId('file-input').setInputFiles([
        {
          name: 'note.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('# Hi\n\nA line of **prose**.\n'),
        },
      ]);

      // Named after the file, without the extension: a document, not bytes.
      const rows = page.getByTestId('file-row');
      const row = rows.filter({ hasText: 'note' }).first();
      await expect(row).toBeVisible();
      await expect(rows.filter({ hasText: 'note.md' })).toHaveCount(0);

      // The import opens it, and the heading is a heading — the markdown
      // was read into the tree, not pasted in as text.
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await expect(editor.locator('h1')).toHaveText('Hi');

      const download = page.waitForEvent('download');
      await row.getByTestId('file-menu').click();
      await page.getByTestId('file-export-markdown').click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('note.md');
      const text = await readFile(await file.path(), 'utf8');
      expect(text.startsWith('# Hi')).toBe(true);
      expect(text).toContain('**prose**');
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
