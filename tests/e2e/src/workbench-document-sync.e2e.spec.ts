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

  /**
   * Two people in one space. The owner's private document must never reach
   * the member — not its node, and not its body through the API either; a
   * document shared at the space floor reaches them whole and keeps syncing.
   */
  test('@full a private document body never reaches a space member; a shared one does', async ({
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
    const asMember = createClient(
      resolveSupabaseUrl(),
      resolveAnonKey(),
      options
    );
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    const deviceB = await contextB.newPage();

    type TextResource = { id: string; body_ref: { doc_id: string } };
    const textResources = async (): Promise<TextResource[]> => {
      const { data, error } = await service
        .from('knowledge_resources')
        .select('id, body_ref')
        .eq('space_id', org.spaceId)
        .eq('kind', 'text');
      if (error) throw new Error(error.message);
      return (data ?? []) as TextResource[];
    };

    try {
      await loginViaUi(owner, seededUser, '/author');
      await expect(owner.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });

      // Two documents by the owner: the first stays private, the second is
      // shared at the space floor. Each is identified by the resource row
      // that reaches the server once it is saved.
      const created: TextResource[] = [];
      for (const text of ['Keep out', 'Shared note']) {
        await owner.getByTestId('new-document').click();
        const editor = owner.locator('[contenteditable="true"]').first();
        await expect(editor).toBeVisible({ timeout: 30_000 });
        await editor.click();
        await editor.pressSequentially(text);
        await expect(owner.getByTestId('save-state')).toContainText(/saved/i);
        await expect
          .poll(async () => (await textResources()).length, {
            timeout: 60_000,
          })
          .toBe(created.length + 1);
        const known = new Set(created.map((row) => row.id));
        const fresh = (await textResources()).find((row) => !known.has(row.id));
        if (!fresh) throw new Error('the new document has no resource row');
        created.push(fresh);
      }
      const [privateDoc, sharedDoc] = created as [TextResource, TextResource];

      // Sharing is the owner's act: only the owner's own session may widen a
      // resource's visibility.
      const ownerSignIn = await asOwner.auth.signInWithPassword({
        email: seededUser.email,
        password: seededUser.password,
      });
      if (ownerSignIn.error) throw new Error(ownerSignIn.error.message);
      const shared = await asOwner
        .from('knowledge_resources')
        .update({ visibility: 'space' })
        .eq('id', sharedDoc.id)
        .select('id');
      expect(shared.error).toBeNull();
      expect(shared.data).toHaveLength(1);

      // The shared body has reached the server.
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('crdt_updates')
              .select('seq')
              .eq('doc_id', sharedDoc.body_ref.doc_id);
            return (data ?? []).length;
          },
          { timeout: 60_000 }
        )
        .toBeGreaterThan(0);

      // Baseline through the service role, so the member's empty reads below
      // are the fence and not an upload that never happened: the private body
      // is on the server too, and each document names the resource that owns
      // it (the device says so when it first registers the document).
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('crdt_updates')
              .select('seq')
              .eq('doc_id', privateDoc.body_ref.doc_id);
            return (data ?? []).length;
          },
          { timeout: 60_000 }
        )
        .toBeGreaterThan(0);
      const registered = await service
        .from('crdt_documents')
        .select('id, resource_id')
        .in('id', [privateDoc.body_ref.doc_id, sharedDoc.body_ref.doc_id]);
      expect(registered.error).toBeNull();
      expect(
        Object.fromEntries(
          (registered.data ?? []).map((row) => [row.id, row.resource_id])
        )
      ).toEqual({
        [privateDoc.body_ref.doc_id]: privateDoc.id,
        [sharedDoc.body_ref.doc_id]: sharedDoc.id,
      });

      // The member's session, straight at the API: the shared body answers,
      // the private one is empty — not an error, simply no rows.
      const memberSignIn = await asMember.auth.signInWithPassword({
        email: member.email,
        password: member.password,
      });
      if (memberSignIn.error) throw new Error(memberSignIn.error.message);
      const privateHead = await asMember
        .from('crdt_documents')
        .select('id')
        .eq('id', privateDoc.body_ref.doc_id);
      expect(privateHead.error).toBeNull();
      expect(privateHead.data).toEqual([]);
      const privateTail = await asMember
        .from('crdt_updates')
        .select('seq')
        .eq('doc_id', privateDoc.body_ref.doc_id);
      expect(privateTail.error).toBeNull();
      expect(privateTail.data).toEqual([]);
      const sharedTail = await asMember
        .from('crdt_updates')
        .select('seq')
        .eq('doc_id', sharedDoc.body_ref.doc_id);
      expect(sharedTail.error).toBeNull();
      expect((sharedTail.data ?? []).length).toBeGreaterThan(0);

      // The member's device: exactly the shared document, with its text, and
      // the owner's next edit arrives in it.
      await loginViaUi(deviceB, member, '/author');
      await expect(deviceB.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      const rows = deviceB.getByTestId('files-section').getByTestId('file-row');
      await expect(rows).toHaveCount(1, { timeout: 60_000 });
      await rows.first().click();
      const editorB = deviceB.locator('[contenteditable="true"]').first();
      await expect(editorB).toHaveText('Shared note', { timeout: 60_000 });

      const editorA = owner.locator('[contenteditable="true"]').first();
      await editorA.click();
      await owner.keyboard.press('End');
      await editorA.pressSequentially(' for everyone');
      await expect(editorB).toHaveText('Shared note for everyone', {
        timeout: 60_000,
      });
    } finally {
      await contextB.close();
      await deleteOrganizationCascade(org.organizationId);
      await cleanupTestUser(member.id);
    }
  });

  /**
   * The creator's second device registers the body first. A document made
   * empty on one device reaches the other as a node alone, and the first
   * person to type in it there is the one who registers the body with the
   * server — the only registration the server takes. The owner must still
   * be named, or the body would stay the creator's alone, shared or not.
   */
  test("@full a document first typed on the creator's second device still reaches a collaborator once shared", async ({
    browser,
    page: deviceA,
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
    const asMember = createClient(
      resolveSupabaseUrl(),
      resolveAnonKey(),
      options
    );
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    const deviceB = await contextB.newPage();
    try {
      // Device A makes an empty document: the node reaches the server, and
      // the body is not registered from here — A's document requests are cut
      // off, since a device that has pushed its first bytes would otherwise
      // register the document before anyone else gets the chance to.
      await loginViaUi(deviceA, seededUser, '/author');
      await expect(deviceA.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await deviceA.route(/\/rest\/v1\/crdt_(documents|updates)/, (route) =>
        route.abort()
      );
      await deviceA.getByTestId('new-document').click();
      await expect(
        deviceA.locator('[contenteditable="true"]').first()
      ).toBeVisible({ timeout: 30_000 });
      let node: { id: string; body_ref: { doc_id: string } } | undefined;
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('knowledge_resources')
              .select('id, body_ref')
              .eq('space_id', org.spaceId)
              .eq('kind', 'text');
            node = (data ?? [])[0] as typeof node;
            return node?.id ?? null;
          },
          { timeout: 60_000 }
        )
        .not.toBeNull();
      const docId = node!.body_ref.doc_id;

      // The owner shares the node at the space floor before anyone types in
      // it, so a member can see it. Seeing it is not editing it: the member
      // asks the server to register the body first, with no owner named,
      // naming the node, and with a node that is not there, and every ask
      // is refused — registering fixes who owns the body for good, and it is
      // the node's editors who may say.
      const ownerSignIn = await asOwner.auth.signInWithPassword({
        email: seededUser.email,
        password: seededUser.password,
      });
      if (ownerSignIn.error) throw new Error(ownerSignIn.error.message);
      const shared = await asOwner
        .from('knowledge_resources')
        .update({ visibility: 'space' })
        .eq('id', node!.id)
        .select('id');
      expect(shared.error).toBeNull();
      expect(shared.data).toHaveLength(1);
      const memberSignIn = await asMember.auth.signInWithPassword({
        email: member.email,
        password: member.password,
      });
      if (memberSignIn.error) throw new Error(memberSignIn.error.message);
      for (const resourceId of [null, node!.id, 'knr_not_on_the_server']) {
        const squat = await asMember.from('crdt_documents').upsert(
          {
            id: docId,
            space_id: org.spaceId,
            created_by: member.id,
            resource_id: resourceId,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
        expect(squat.error?.code, `registering as ${resourceId}`).toBe('42501');
      }
      const squatted = await service
        .from('crdt_documents')
        .select('id')
        .eq('id', docId);
      expect(squatted.data).toEqual([]);

      // Device B, the same person, receives the node and types first.
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
      await expect(editorB).toBeVisible({ timeout: 60_000 });
      await editorB.click();
      await editorB.pressSequentially('First typed on B');
      await expect(deviceB.getByTestId('save-state')).toContainText(/saved/i);

      // B registered the body, and named the node that owns it.
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('crdt_documents')
              .select('resource_id')
              .eq('id', docId);
            return data?.[0]?.resource_id ?? null;
          },
          { timeout: 60_000 }
        )
        .toBe(node!.id);

      // Shared at the space floor, the body reaches the member. The row that
      // names the owner lands first and the bytes follow in the same push.
      await expect
        .poll(
          async () => {
            const tail = await asMember
              .from('crdt_updates')
              .select('seq')
              .eq('doc_id', docId);
            expect(tail.error).toBeNull();
            return (tail.data ?? []).length;
          },
          { timeout: 60_000 }
        )
        .toBeGreaterThan(0);
    } finally {
      await contextB.close();
      await deleteOrganizationCascade(org.organizationId);
      await cleanupTestUser(member.id);
    }
  });

  /**
   * A collaborator who may edit what is shared with them is not the one who
   * registered the body, and has no business naming its owner: their first
   * push finds the row already there and goes straight to the update log.
   */
  test('@full an author edits a shared document its creator registered, and the creator sees it', async ({
    browser,
    page: owner,
    seededUser,
  }) => {
    test.setTimeout(300_000);
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const author = await seedTestUser();
    await bootstrapSpaceMemberForUser({
      organizationId: org.organizationId,
      spaceId: org.spaceId,
      userId: author.id,
      role: 'author',
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
    const deviceB = await contextB.newPage();
    try {
      await loginViaUi(owner, seededUser, '/author');
      await expect(owner.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await owner.getByTestId('new-document').click();
      const editorA = owner.locator('[contenteditable="true"]').first();
      await expect(editorA).toBeVisible({ timeout: 30_000 });
      await editorA.click();
      await editorA.pressSequentially('Shared with an author');
      await expect(owner.getByTestId('save-state')).toContainText(/saved/i);

      let node: { id: string; body_ref: { doc_id: string } } | undefined;
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('knowledge_resources')
              .select('id, body_ref')
              .eq('space_id', org.spaceId)
              .eq('kind', 'text');
            node = (data ?? [])[0] as typeof node;
            return node?.id ?? null;
          },
          { timeout: 60_000 }
        )
        .not.toBeNull();
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('crdt_documents')
              .select('resource_id')
              .eq('id', node!.body_ref.doc_id);
            return data?.[0]?.resource_id ?? null;
          },
          { timeout: 60_000 }
        )
        .toBe(node!.id);

      const ownerSignIn = await asOwner.auth.signInWithPassword({
        email: seededUser.email,
        password: seededUser.password,
      });
      if (ownerSignIn.error) throw new Error(ownerSignIn.error.message);
      const shared = await asOwner
        .from('knowledge_resources')
        .update({ visibility: 'space' })
        .eq('id', node!.id)
        .select('id');
      expect(shared.error).toBeNull();
      expect(shared.data).toHaveLength(1);

      await loginViaUi(deviceB, author, '/author');
      await expect(deviceB.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      const rows = deviceB.getByTestId('files-section').getByTestId('file-row');
      await expect(rows).toHaveCount(1, { timeout: 60_000 });
      await rows.first().click();
      const editorB = deviceB.locator('[contenteditable="true"]').first();
      await expect(editorB).toHaveText('Shared with an author', {
        timeout: 60_000,
      });
      await editorB.click();
      await deviceB.keyboard.press('End');
      await editorB.pressSequentially(' and edited by them');

      await expect(editorA).toHaveText(
        'Shared with an author and edited by them',
        { timeout: 60_000 }
      );
      // Still named for the node it was registered with, by the creator.
      const { data } = await service
        .from('crdt_documents')
        .select('resource_id, created_by')
        .eq('id', node!.body_ref.doc_id);
      expect(data?.[0]).toEqual({
        resource_id: node!.id,
        created_by: seededUser.id,
      });
    } finally {
      await contextB.close();
      await deleteOrganizationCascade(org.organizationId);
      await cleanupTestUser(author.id);
    }
  });
});
