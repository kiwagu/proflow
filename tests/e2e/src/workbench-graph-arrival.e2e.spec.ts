import { createClient } from '@supabase/supabase-js';

import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  bootstrapSpaceMemberForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';
import {
  cleanupTestUser,
  resolveAnonKey,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
  seedTestUser,
} from './helpers/test-user.js';

/**
 * A document another person adds to a shared folder arrives on this device
 * through the graph pull, table by table. The tree must never draw it at
 * the top level for a moment and then move it into the folder: it appears
 * once, in its place. Every rendering of the member's tree is recorded from
 * inside the page, so a single wrong frame fails the test.
 */
test.describe('Workbench graph arrival', () => {
  test('@full a document added to a shared folder by its owner appears in the folder, never at the top level first', async ({
    browser,
    page: owner,
    seededUser,
  }) => {
    test.setTimeout(300_000);
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const member = await seedTestUser();
    await bootstrapSpaceMemberForUser({
      organizationId: org.organizationId,
      spaceId: org.spaceId,
      userId: member.id,
    });
    const options = {
      auth: { autoRefreshToken: false, persistSession: false },
    };
    const service = createClient(
      resolveSupabaseUrl(),
      resolveServiceRoleKey(),
      options
    );
    const asOwner = createClient(
      resolveSupabaseUrl(),
      resolveAnonKey(),
      options
    );
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await contextB.newPage();
    const rowsOn = (page: typeof owner) =>
      page.getByTestId('files-section').getByTestId('file-row');
    try {
      await loginViaUi(owner, seededUser, '/author');
      await expect(owner.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await owner.getByTestId('new-folder').click();
      const folderRow = rowsOn(owner).filter({ hasText: 'New folder' });
      await expect(folderRow).toBeVisible({ timeout: 30_000 });
      // One document inside, so the member's view of the folder is not
      // empty before the one under test arrives.
      await folderRow.click();
      await owner.getByTestId('new-document').click();
      await expect(rowsOn(owner)).toHaveCount(2, { timeout: 30_000 });

      let ids: string[] = [];
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('knowledge_resources')
              .select('id')
              .eq('space_id', org.spaceId);
            ids = (data ?? []).map((row) => row.id);
            return ids.length;
          },
          { timeout: 60_000 }
        )
        .toBe(2);
      // The owner shares the folder; what it contains is readable through it.
      const ownerSignIn = await asOwner.auth.signInWithPassword({
        email: seededUser.email,
        password: seededUser.password,
      });
      if (ownerSignIn.error) throw new Error(ownerSignIn.error.message);
      const shared = await asOwner
        .from('knowledge_resources')
        .update({ visibility: 'space' })
        .in('id', ids)
        .select('id');
      expect(shared.error).toBeNull();
      expect(shared.data).toHaveLength(2);

      await loginViaUi(memberPage, member, '/author');
      await expect(memberPage.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await expect(rowsOn(memberPage)).toHaveCount(1, { timeout: 60_000 });
      await rowsOn(memberPage).first().click();
      await expect(rowsOn(memberPage)).toHaveCount(2, { timeout: 60_000 });

      // Record every rendering of the member's tree from now on: the rows in
      // order, each with its indentation, which is its depth.
      await memberPage.evaluate(() => {
        const section = document.querySelector('[data-testid="files-section"]');
        if (!section) throw new Error('no files section');
        const frames: string[] = [];
        const snapshot = () =>
          [...section.querySelectorAll('[data-testid="file-row"]')]
            .map((row) => {
              const indented = row.querySelector<HTMLElement>(
                '[style*="padding-left"]'
              );
              const title = (row as HTMLElement).innerText
                .trim()
                .split('\n')[0];
              return `${title}@${indented?.style.paddingLeft ?? '?'}`;
            })
            .join('|');
        frames.push(snapshot());
        new MutationObserver(() => {
          const frame = snapshot();
          if (frame !== frames[frames.length - 1]) frames.push(frame);
        }).observe(section, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        (window as unknown as { __treeFrames: string[] }).__treeFrames = frames;
      });

      // The owner adds a second document to the folder.
      await folderRow.click();
      await owner.getByTestId('new-document').click();
      await expect(rowsOn(owner)).toHaveCount(3, { timeout: 30_000 });
      await expect(rowsOn(memberPage)).toHaveCount(3, { timeout: 60_000 });
      // Let the tree settle after the last pull before reading the frames.
      await memberPage.waitForTimeout(2_000);

      const frames = await memberPage.evaluate(
        () => (window as unknown as { __treeFrames: string[] }).__treeFrames
      );
      const folderDepth = frames[0]!.split('|')[0]!.split('@')[1];
      const topLevelUntitled = frames.filter((frame) =>
        frame
          .split('|')
          .slice(1)
          .some((row) => row === `Untitled@${folderDepth}`)
      );
      expect(topLevelUntitled, frames.join('\n')).toEqual([]);
      expect(frames[frames.length - 1]!.split('|')).toHaveLength(3);
    } finally {
      await contextB.close();
      await deleteOrganizationCascade(org.organizationId);
      await cleanupTestUser(member.id);
    }
  });
});
