import { createClient } from '@supabase/supabase-js';
import type { Browser, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  bootstrapSpaceMemberForUser,
  deleteOrganizationCascade,
  setSpaceRoleForUser,
} from './helpers/platform-org-bootstrap.js';
import {
  cleanupTestUser,
  resolveAnonKey,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
  seedTestUser,
} from './helpers/test-user.js';

/**
 * The workbench offers only what the server would let through. A space
 * member may read a shared document but not write it: the pane opens read
 * only, typing changes nothing, nothing is ever sent and nothing is
 * reported as failing; the tree leaves out what the member may not do to
 * someone else's node. Raising the member's role opens the same pane for
 * writing without a reload.
 */
test.describe('Workbench write scope', () => {
  async function setUp(
    browser: Browser,
    owner: Page,
    seededUser: { id: string; email: string; password: string }
  ) {
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
    const updatePosts: string[] = [];
    memberPage.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/rest/v1/crdt_updates')
      )
        updatePosts.push(request.url());
    });

    // The owner writes a document and shares it at the space floor.
    await loginViaUi(owner, seededUser, '/author');
    await expect(owner.getByTestId('workbench-ready')).toBeVisible({
      timeout: 120_000,
    });
    await owner.getByTestId('new-document').click();
    const ownerEditor = owner.locator('[contenteditable="true"]').first();
    await expect(ownerEditor).toBeVisible({ timeout: 30_000 });
    await ownerEditor.click();
    await ownerEditor.pressSequentially('Owner text');
    await expect(owner.getByTestId('save-state')).toContainText(/saved/i, {
      timeout: 30_000,
    });
    let nodeId = '';
    await expect
      .poll(
        async () => {
          const { data } = await service
            .from('knowledge_resources')
            .select('id, body_ref')
            .eq('space_id', org.spaceId)
            .eq('kind', 'text');
          nodeId = (data ?? [])[0]?.id ?? '';
          const docId = (data ?? [])[0]?.body_ref?.doc_id;
          if (!docId) return 0;
          const { data: rows } = await service
            .from('crdt_updates')
            .select('seq')
            .eq('doc_id', docId);
          return (rows ?? []).length;
        },
        { timeout: 60_000 }
      )
      .toBeGreaterThan(0);
    const signIn = await asOwner.auth.signInWithPassword({
      email: seededUser.email,
      password: seededUser.password,
    });
    if (signIn.error) throw new Error(signIn.error.message);
    const shared = await asOwner
      .from('knowledge_resources')
      .update({ visibility: 'space' })
      .eq('id', nodeId)
      .select('id');
    expect(shared.data).toHaveLength(1);

    // The member opens it.
    await loginViaUi(memberPage, member, '/author');
    await expect(memberPage.getByTestId('workbench-ready')).toBeVisible({
      timeout: 120_000,
    });
    const memberRows = memberPage
      .getByTestId('files-section')
      .getByTestId('file-row');
    await expect(memberRows).toHaveCount(1, { timeout: 60_000 });
    await memberRows.first().click();
    const memberEditor = memberPage.locator('[data-lexical-editor]').first();
    await expect(memberEditor).toHaveText('Owner text', { timeout: 60_000 });

    return {
      org,
      member,
      contextB,
      memberPage,
      memberEditor,
      memberRows,
      ownerEditor,
      updatePosts,
    };
  }

  test("@full a member reads a shared document read-only: typing changes nothing, nothing is sent, the tree offers no rename or delete of the owner's node", async ({
    browser,
    page: owner,
    seededUser,
  }) => {
    test.setTimeout(300_000);
    const s = await setUp(browser, owner, seededUser);
    try {
      await expect(s.memberPage.getByTestId('document-read-only')).toBeVisible({
        timeout: 30_000,
      });
      await expect(s.memberEditor).toHaveAttribute('contenteditable', 'false');
      await s.memberEditor.click();
      await s.memberPage.keyboard.type(' member typing');
      await expect(s.memberEditor).toHaveText('Owner text');

      // The owner's next words still arrive.
      await s.ownerEditor.click();
      await owner.keyboard.press('End');
      await s.ownerEditor.pressSequentially(' and more');
      await expect(s.memberEditor).toHaveText('Owner text and more', {
        timeout: 60_000,
      });

      // The owner's node offers the member no rename or delete. It has no
      // place yet, and filing a node with no place needs only the create verb,
      // so move stays.
      await s.memberRows.first().hover();
      await s.memberRows.first().getByTestId('file-menu').click();
      await expect(s.memberPage.getByRole('menu')).toBeVisible();
      await expect(
        s.memberPage.getByRole('menuitem', { name: /rename/i })
      ).toHaveCount(0);
      await expect(
        s.memberPage.getByRole('menuitem', { name: /move/i })
      ).toHaveCount(1);
      await expect(s.memberPage.getByTestId('file-delete')).toHaveCount(0);
      await s.memberPage.keyboard.press('Escape');

      // Nothing was ever sent, and nothing reported.
      await s.memberPage.waitForTimeout(3_000);
      expect(s.updatePosts).toEqual([]);
      await expect(s.memberPage.getByText(/could not send/i)).toHaveCount(0);
    } finally {
      await s.contextB.close();
      await deleteOrganizationCascade(s.org.organizationId);
      await cleanupTestUser(s.member.id);
    }
  });

  test('@full raising the member to author opens the same pane for writing, without a reload', async ({
    browser,
    page: owner,
    seededUser,
  }) => {
    test.setTimeout(300_000);
    const s = await setUp(browser, owner, seededUser);
    try {
      await expect(s.memberPage.getByTestId('document-read-only')).toBeVisible({
        timeout: 30_000,
      });
      await setSpaceRoleForUser({
        spaceId: s.org.spaceId,
        userId: s.member.id,
        role: 'author',
      });
      // The next session check (every 15 s, or on focus) states the new scope.
      await s.memberPage.evaluate(() =>
        window.dispatchEvent(new Event('focus'))
      );
      await expect(s.memberPage.getByTestId('document-read-only')).toHaveCount(
        0,
        { timeout: 45_000 }
      );
      await expect(s.memberEditor).toHaveAttribute('contenteditable', 'true');
      await s.memberEditor.click();
      await s.memberPage.keyboard.press('End');
      await s.memberPage.keyboard.type(' from the author');
      await expect(s.ownerEditor).toHaveText('Owner text from the author', {
        timeout: 60_000,
      });
    } finally {
      await s.contextB.close();
      await deleteOrganizationCascade(s.org.organizationId);
      await cleanupTestUser(s.member.id);
    }
  });
});
