import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

/**
 * One account on two devices. A second browser context is a second device:
 * its own cookies, its own local database. Nothing here reloads a page —
 * what the other device typed has to arrive in an editor that stays open.
 */
test.describe('Workbench document sync across devices', () => {
  test('@full a document typed on one device opens on another, and edits flow both ways', async ({
    browser,
    page: deviceA,
    seededUser,
  }) => {
    test.setTimeout(300_000);
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    const deviceB = await contextB.newPage();
    try {
      await loginViaUi(deviceA, seededUser, '/author');
      await expect(deviceA.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await deviceA.getByTestId('new-document').click();
      const editorA = deviceA.locator('[contenteditable="true"]').first();
      await expect(editorA).toBeVisible({ timeout: 30_000 });
      await editorA.click();
      await editorA.pressSequentially('Hello from A');
      await expect(deviceA.getByTestId('save-state')).toContainText(/saved/i);

      // Device B: the node arrives through the graph, the body by name.
      await loginViaUi(deviceB, seededUser, '/author');
      await expect(deviceB.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      const rowB = deviceB
        .getByTestId('files-section')
        .getByTestId('file-row')
        .first();
      await expect(rowB).toBeVisible({ timeout: 60_000 });
      await rowB.click();
      const editorB = deviceB.locator('[contenteditable="true"]').first();
      await expect(editorB).toHaveText('Hello from A', { timeout: 60_000 });

      // B types; A sees it without a reload.
      await editorB.click();
      await deviceB.keyboard.press('End');
      await editorB.pressSequentially(' and B');
      await expect(editorA).toHaveText('Hello from A and B', {
        timeout: 60_000,
      });

      // A edits offline while B keeps typing; back online, both converge.
      await deviceA.context().setOffline(true);
      await editorA.click();
      await deviceA.keyboard.press('End');
      await editorA.pressSequentially(' offline');
      await editorB.click();
      await deviceB.keyboard.press('End');
      await editorB.pressSequentially(' meanwhile');
      await expect(deviceB.getByTestId('save-state')).toContainText(/saved/i);
      await deviceA.context().setOffline(false);
      await expect(editorA).toContainText('meanwhile', { timeout: 60_000 });
      await expect(editorB).toContainText('offline', { timeout: 60_000 });
      // Converged: both editors say the same thing, whichever order the
      // CRDT put the two appends in.
      await expect
        .poll(
          async () =>
            (await editorA.innerText()) === (await editorB.innerText()),
          { timeout: 60_000 }
        )
        .toBe(true);
    } finally {
      await contextB.close();
      await deleteOrganizationCascade(org.organizationId);
    }
  });

  test("@full two tabs of one browser show each other's edits without a reload", async ({
    page: tabA,
    seededUser,
  }) => {
    test.setTimeout(300_000);
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    try {
      await loginViaUi(tabA, seededUser, '/author');
      await expect(tabA.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await tabA.getByTestId('new-document').click();
      const editorA = tabA.locator('[contenteditable="true"]').first();
      await expect(editorA).toBeVisible({ timeout: 30_000 });
      await editorA.click();
      await editorA.pressSequentially('Hello from tab A');
      await expect(tabA.getByTestId('save-state')).toContainText(/saved/i);

      // A second tab of the same browser: the same local database.
      const tabB = await tabA.context().newPage();
      await tabB.goto('/author/');
      await expect(tabB.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await tabB
        .getByTestId('files-section')
        .getByTestId('file-row')
        .first()
        .click();
      const editorB = tabB.locator('[contenteditable="true"]').first();
      await expect(editorB).toHaveText('Hello from tab A', { timeout: 60_000 });

      await editorB.click();
      await tabB.keyboard.press('End');
      await editorB.pressSequentially(' and tab B');
      await expect(editorA).toHaveText('Hello from tab A and tab B', {
        timeout: 60_000,
      });

      await tabA.bringToFront();
      await editorA.click();
      await tabA.keyboard.press('End');
      await editorA.pressSequentially(' again');
      await expect(editorB).toHaveText('Hello from tab A and tab B again', {
        timeout: 60_000,
      });
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
