import { createHash } from 'node:crypto';
import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

// Instrument only this browser's dev module, never the shipped app. Reads go
// through the very same ports the UI owns: no second database/worker, no mocks.
const probeModule = `
const originalCreateAppServices = createAppServices;
createAppServices = async (...args) => {
  const services = await originalCreateAppServices(...args);
  window.trashProbe = async (hash) => ({
    rows: (await services.db.query('select hash from blob where hash = $1', [hash])).rows.length,
    bytes: await (await services.blobs.get(hash))?.text() ?? null,
  });
  return services;
};
`;

test('@smoke trash restores original bytes and permanent deletion reclaims only purged files', async ({
  page,
  seededUser,
}) => {
  test.setTimeout(180_000);
  const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
  await page.route(/\/src\/composition\/root\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + probeModule,
    });
  });
  const content = 'Recoverable file bytes';
  const disposable = 'Permanently removed bytes';
  const hash = (text: string) =>
    createHash('sha256').update(text).digest('hex');
  const probe = (text: string) =>
    page.evaluate(async (key) => {
      const read = (
        window as unknown as {
          trashProbe: (
            hash: string
          ) => Promise<{ rows: number; bytes: string | null }>;
        }
      ).trashProbe;
      return read(key);
    }, hash(text));
  const fileRow = (name: string) =>
    page.getByTestId('file-row').filter({ hasText: name });
  const trashRow = (name: string) =>
    page.getByTestId('trash-result').filter({ hasText: name });
  const trash = async (name: string) => {
    await fileRow(name).getByTestId('file-menu').click();
    await page.getByTestId('file-delete').click();
    await expect(fileRow(name)).toHaveCount(0);
    await expect(trashRow(name)).toBeVisible();
  };
  try {
    await loginViaUi(page, seededUser, '/author');
    await expect(page.getByTestId('workbench-ready')).toBeVisible({
      timeout: 120_000,
    });
    // This scenario exercises local ownership and irreversible local GC,
    // independently of the server's asynchronous journal replay.
    await page.context().setOffline(true);
    await page.getByTestId('trash-panel-trigger').click();
    await expect(page.getByTestId('trash-empty')).toBeVisible();
    await page.getByTestId('file-input').setInputFiles([
      {
        name: 'recoverable.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      },
      {
        name: 'disposable.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(disposable),
      },
    ]);
    await expect(fileRow('recoverable.txt')).toBeVisible();
    await expect(fileRow('disposable.txt')).toBeVisible();
    await trash('recoverable.txt');
    await trash('disposable.txt');
    await trashRow('disposable.txt').click();
    await page.getByTestId('trash-purge').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('disposable.txt');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await probe(disposable)).toEqual({ rows: 1, bytes: disposable });
    await page.getByTestId('trash-purge').click();
    await dialog
      .getByRole('button', { name: 'Delete forever', exact: true })
      .click();
    await expect(page.getByTestId('trash-freed')).toBeVisible();
    await expect(trashRow('disposable.txt')).toHaveCount(0);
    const purged = await probe(disposable);
    console.log('PROBE_PURGED', JSON.stringify(purged));
    expect(purged).toEqual({ rows: 0, bytes: null });
    // GC just ran while this file remained in Trash. Both metadata and bytes
    // must survive, not merely a row that restore could show without content.
    const kept = await probe(content);
    console.log('PROBE_TRASH_AFTER_GC', JSON.stringify(kept));
    expect(kept).toEqual({ rows: 1, bytes: content });
    await trashRow('recoverable.txt').click();
    await page.getByTestId('trash-restore').click();
    await expect(trashRow('recoverable.txt')).toHaveCount(0);
    await expect(fileRow('recoverable.txt')).toBeVisible();
    await fileRow('recoverable.txt').click();
    await expect(page.getByText(content, { exact: true })).toBeVisible();
    expect(await probe(content)).toEqual({ rows: 1, bytes: content });
    await expect(page.getByTestId('trash-empty')).toBeVisible();
  } finally {
    await page.context().setOffline(false);
    await deleteOrganizationCascade(org.organizationId);
  }
});
