import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

/**
 * The assistant panel, end to end over the app's own agent worker.
 *
 * With no provider key configured the worker answers from the scripted local
 * model, so the reply's opening line is a fixed string — asserting on it
 * proves the whole path at once: the panel opened a session, the send
 * reached the worker, the stream came back and was rendered. Asserting on
 * the question instead would prove nothing, since the transcript shows the
 * user's own message too.
 */
test.describe('Workbench chat panel', () => {
  test.describe.configure({ timeout: 300_000 });

  test('@smoke the assistant answers in the transcript', async ({
    page,
    seededUser,
  }) => {
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    try {
      await loginViaUi(page, seededUser, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });

      // The trigger only exists once the page started an agent worker, so
      // waiting for it is also waiting for the worker.
      await expect(page.getByTestId('chat-panel-trigger')).toBeVisible({
        timeout: 120_000,
      });

      // Opened by the shortcut, because the shortcut is the part that can
      // silently not fire — a click would not prove the binding is live.
      await page.keyboard.press('Control+Shift+L');
      const composer = page.getByTestId('chat-input');
      await expect(composer).toBeVisible();
      await expect(composer).toBeEnabled({ timeout: 60_000 });

      await composer.fill('hello');
      await composer.press('Enter');

      // Stop replaces Send for exactly as long as the turn runs.
      await expect(page.getByTestId('chat-stop')).toBeVisible({
        timeout: 60_000,
      });

      await expect(page.getByTestId('chat-transcript')).toContainText(
        'Hello from the local model',
        { timeout: 180_000 }
      );
      await expect(page.getByTestId('chat-send')).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId('chat-stop')).toHaveCount(0);

      // Closing takes the region away entirely rather than hiding it. The
      // toggle is clicked rather than pressed here: the shortcut registry
      // deliberately yields to a focused text field, and focus is in the
      // composer at this point.
      await page.getByTestId('chat-panel-trigger').click();
      await expect(page.getByTestId('chat-input')).toHaveCount(0);
    } finally {
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
