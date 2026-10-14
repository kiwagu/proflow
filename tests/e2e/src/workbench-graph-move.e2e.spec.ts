import { createClient } from '@supabase/supabase-js';

import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';
import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from './helpers/test-user.js';

/**
 * A move is replayed on the server by an RPC that writes the containment
 * edge itself, under an id of its own. The device that made the move holds
 * the same edge under the id it minted; when the server's edge comes back in
 * a pull, the replica must take it. If it refuses it instead, that device
 * never completes a pull again: whatever changes on the server after the move
 * never reaches it.
 */
test.describe('Workbench graph moves', () => {
  test('@full a document moved into a folder keeps the device pulling, and another device sees it there', async ({
    browser,
    page: deviceA,
    seededUser,
  }) => {
    test.setTimeout(300_000);
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const service = createClient(
      resolveSupabaseUrl(),
      resolveServiceRoleKey(),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    const deviceB = await contextB.newPage();
    const rowOn = (page: typeof deviceA, name: string) =>
      page
        .getByTestId('files-section')
        .getByTestId('file-row')
        .filter({ hasText: name });
    try {
      await loginViaUi(deviceA, seededUser, '/author');
      await expect(deviceA.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });

      // A document at the top level, then a folder beside it.
      await deviceA.getByTestId('new-document').click();
      await expect(rowOn(deviceA, 'Untitled')).toBeVisible({ timeout: 30_000 });
      await deviceA.getByTestId('new-folder').click();
      await expect(rowOn(deviceA, 'New folder')).toBeVisible({
        timeout: 30_000,
      });

      // Wait for both nodes on the server, so the move replays against them.
      type Node = { id: string; kind: string };
      let nodes: Node[] = [];
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('knowledge_resources')
              .select('id, kind')
              .eq('space_id', org.spaceId);
            nodes = (data ?? []) as Node[];
            return nodes.length;
          },
          { timeout: 60_000 }
        )
        .toBe(2);
      const doc = nodes.find((n) => n.kind === 'text')!;
      const folder = nodes.find((n) => n.kind === 'folder')!;

      // The move, through the row's menu.
      await rowOn(deviceA, 'Untitled').hover();
      await rowOn(deviceA, 'Untitled').getByTestId('file-menu').click();
      await deviceA.getByTestId('file-move').click();
      await deviceA
        .getByTestId('file-move-target')
        .filter({ hasText: 'New folder' })
        .click();

      // The server holds the edge, written by the RPC.
      await expect
        .poll(
          async () => {
            const { data } = await service
              .from('knowledge_edges')
              .select('from_id')
              .eq('to_id', doc.id)
              .eq('relation_type', 'contains');
            return data?.[0]?.from_id ?? null;
          },
          { timeout: 60_000 }
        )
        .toBe(folder.id);

      // A change the server makes after the move still reaches device A. The
      // replica pulls the tables in a fixed order and the per-user state comes
      // after the edges, so a star set on the server arrives only if the pull
      // got past the moved edge.
      const starred = await service.from('resource_user_state').insert({
        user_id: seededUser.id,
        resource_id: doc.id,
        space_id: org.spaceId,
        starred: true,
      });
      expect(starred.error).toBeNull();
      await expect(
        rowOn(deviceA, 'Untitled').getByLabel('Starred')
      ).toBeVisible({ timeout: 60_000 });

      // Device B, the same person, finds the document inside the folder.
      await loginViaUi(deviceB, seededUser, '/author');
      await expect(deviceB.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await rowOn(deviceB, 'New folder').click();
      await expect(rowOn(deviceB, 'Untitled')).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await contextB.close();
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
