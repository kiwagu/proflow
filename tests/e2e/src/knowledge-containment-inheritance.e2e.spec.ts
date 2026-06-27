/**
 * Owner-scoped, live containment access inheritance — ADR-0023 (the merge gate).
 *
 * Proves the NEW additive OR'd disjunct on the knowledge-resource visibility predicate
 * (`auth_user_can_access_resource` → `knowledge_resource_inherited_grant`): a node is
 * readable if it OR an ANCESTOR folder (up the forward `contains` forest) is granted to
 * the viewer — but OWNER-SCOPED (the cascade only reaches the folder owner's OWN
 * descendants), LIVE (a new child auto-appears; a revoke removes the subtree), and
 * additive-OR (a self-granted child survives the folder revoke). The change is purely
 * WIDENING — it can only ever grant MORE reads, never fence — so the existing access
 * matrices must stay green (a regression there is an over-grant bug).
 *
 * The multi-owner tree + the seeded grants come from the SHARED
 * `CONTAINMENT_INHERITANCE_SCENARIO` catalog entry (via `seedContainmentInheritanceFixture`),
 * so the demo DB and this test build the folders / containment / per-user + cohort + floor
 * grants through the ONE `/author/graph/*` create-vocabulary. The LIVE arcs (a NEW child, a
 * REVOKE, a RE-GRANT) are driven through the SAME shared vocabulary
 * (`seedClientFor(owner).createDoc/contain/revokeUser/grantUser`) — no inline tree, no
 * hand-built grants. The cycle case injects a `contains` cycle through the owner's RLS
 * client (a cycle is not expressible in the declarative tree).
 *
 * RLS is the SOLE fence (ADR-0017 §1.5 + ADR-0023): a node a viewer may not see is ABSENT
 * from a direct `knowledge_resources` select under that viewer's RLS client — never returned
 * with a flag. So `canSee` = "the row comes back under your own JWT".
 *
 * The 9 proving tests (ADR-0023 §Implementation outline, Wave 1 §4):
 *  (1) a granted folder exposes the GRANTOR's OWN descendants (live);
 *  (2) NEGATIVE — owner-scope: a folder grant does NOT expose another owner's nested node;
 *  (3) NEGATIVE — no admin cascade: an admin sharing a folder does NOT expose another
 *      owner's nested node; only that owner's OWN explicit grant exposes it;
 *  (4) a NEW child placed into a granted folder auto-appears with no re-grant (live);
 *  (5) revoking the folder grant removes the whole subtree's inherited visibility (live);
 *  (6) an independently-granted child SURVIVES the folder revoke (additive-OR);
 *  (7) floor inheritance: a space-floor folder makes the owner's OWN descendants
 *      space-visible (owner-scoped) but NOT another owner's nested node;
 *  (8) a cohort-shared folder inherits owner-scoped;
 *  (9) a `contains` cycle does not hang or over-grant (depth-32 + `union` guard).
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  seedClientFor,
  seedContainmentInheritanceFixture,
  teardownKnowledgeGraphTenant,
  type ContainmentInheritanceFixture,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

/** Can this actor SEE the resource? RLS is the fence — a hidden row is ABSENT. */
async function canSee(
  db: SupabaseClient,
  resourceId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('knowledge_resources')
    .select('id')
    .eq('id', resourceId)
    .maybeSingle();
  expect(error).toBeNull();
  return data?.id === resourceId;
}

test.describe('containment access inheritance — owner-scoped, live @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: ContainmentInheritanceFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedContainmentInheritanceFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        [
          fx?.grantee.userId,
          fx?.ownerB.userId,
          fx?.adminC.userId,
          fx?.cohortMember.userId,
          fx?.cohortStranger.userId,
        ].filter((id): id is string => Boolean(id))
      );
    }
  });

  test("(1) a granted folder exposes the grantor's OWN descendants (live)", async () => {
    // The owner always sees its own content.
    expect(await canSee(fx.owner.client, fx.sharedFolderId)).toBe(true);
    expect(await canSee(fx.owner.client, fx.ownChildId)).toBe(true);

    // The grantee sees the folder it was granted directly …
    expect(await canSee(fx.grantee.client, fx.sharedFolderId)).toBe(true);
    // … and the owner's OWN child INSIDE it — purely via inheritance (no direct grant).
    expect(await canSee(fx.grantee.client, fx.ownChildId)).toBe(true);
    // … reaching the deeper subfolder and its grandchild (the >1-level recursive walk).
    expect(await canSee(fx.grantee.client, fx.ownSubfolderId)).toBe(true);
    expect(await canSee(fx.grantee.client, fx.ownGrandchildId)).toBe(true);
  });

  test("(2) NEGATIVE owner-scope: a folder grant does NOT expose another owner's nested node", async () => {
    // `foreignChild` is owned by ownerB and merely FILED into A's shared folder. The folder
    // grant is owner-scoped (same-owner spine), so it never carries onto ownerB's node.
    expect(await canSee(fx.grantee.client, fx.foreignChildId)).toBe(false);
    // ownerB (its owner) still sees it; the cascade subtracts nothing.
    expect(await canSee(fx.ownerB.client, fx.foreignChildId)).toBe(true);
  });

  test("(3) NEGATIVE no admin cascade: an admin sharing a folder does NOT expose another owner's nested node", async () => {
    // The grantee sees the admin's folder it was granted …
    expect(await canSee(fx.grantee.client, fx.curatorFolderId)).toBe(true);
    // … but NOT ownerB's node nested inside it: an admin's folder-share is still
    // same-owner-only (no curator cross-owner cascade — the dropped branch).
    expect(await canSee(fx.grantee.client, fx.curatorForeignChildId)).toBe(
      false
    );

    // Only ownerB's OWN explicit per-node grant exposes it. ownerB grants its node to the
    // grantee directly (owner-sovereign) → now visible; revoke restores the negative.
    const ownerBClient = await seedClientFor(fx.ownerB);
    try {
      await ownerBClient.grantUser(fx.curatorForeignChildId, fx.grantee.userId);
      expect(await canSee(fx.grantee.client, fx.curatorForeignChildId)).toBe(
        true
      );
      await ownerBClient.revokeUser(
        fx.curatorForeignChildId,
        fx.grantee.userId
      );
      expect(await canSee(fx.grantee.client, fx.curatorForeignChildId)).toBe(
        false
      );
    } finally {
      await ownerBClient.dispose();
    }
  });

  test('(4) a NEW child placed into a granted folder auto-appears with no re-grant (live)', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // The owner creates a brand-new doc and files it into the already-granted folder.
      const created = await ownerClient.createDoc(
        fx.spaceId,
        'Live New Child Doc',
        { parentFolderId: fx.sharedFolderId }
      );
      // The grantee sees it IMMEDIATELY — no re-grant, no backfill (the live predicate).
      expect(await canSee(fx.grantee.client, created.nodeId)).toBe(true);
      // The owner sees its own content too.
      expect(await canSee(fx.owner.client, created.nodeId)).toBe(true);
    } finally {
      await ownerClient.dispose();
    }
  });

  test("(5) revoking the folder grant removes the whole subtree's inherited visibility (live)", async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // Pre-condition: the grantee currently inherits the own-child + grandchild.
      expect(await canSee(fx.grantee.client, fx.ownChildId)).toBe(true);
      expect(await canSee(fx.grantee.client, fx.ownGrandchildId)).toBe(true);

      // Revoke the FOLDER grant (the only widening disjunct for these descendants).
      await ownerClient.revokeUser(fx.sharedFolderId, fx.grantee.userId);

      // The whole inherited subtree disappears LIVE — no orphaned per-child state.
      expect(await canSee(fx.grantee.client, fx.sharedFolderId)).toBe(false);
      expect(await canSee(fx.grantee.client, fx.ownChildId)).toBe(false);
      expect(await canSee(fx.grantee.client, fx.ownSubfolderId)).toBe(false);
      expect(await canSee(fx.grantee.client, fx.ownGrandchildId)).toBe(false);
      // The owner is untouched (non-destructive).
      expect(await canSee(fx.owner.client, fx.ownChildId)).toBe(true);

      // Restore the folder grant for re-runnability + the additive-OR check below.
      await ownerClient.grantUser(fx.sharedFolderId, fx.grantee.userId);
      expect(await canSee(fx.grantee.client, fx.ownChildId)).toBe(true);
    } finally {
      await ownerClient.dispose();
    }
  });

  test('(6) an independently-granted child SURVIVES the folder revoke (additive-OR)', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // `selfGrantedChild` is reachable BOTH via the folder grant AND its own direct grant.
      expect(await canSee(fx.grantee.client, fx.selfGrantedChildId)).toBe(true);

      // Revoke the FOLDER grant — the inherited disjunct goes away …
      await ownerClient.revokeUser(fx.sharedFolderId, fx.grantee.userId);
      // … but the child's OWN direct grant still admits it (the OR has another true term).
      expect(await canSee(fx.grantee.client, fx.selfGrantedChildId)).toBe(true);
      // Its plain sibling (folder-only) is gone, confirming the revoke really took effect.
      expect(await canSee(fx.grantee.client, fx.ownChildId)).toBe(false);

      // Restore the clean slate.
      await ownerClient.grantUser(fx.sharedFolderId, fx.grantee.userId);
      expect(await canSee(fx.grantee.client, fx.ownChildId)).toBe(true);
    } finally {
      await ownerClient.dispose();
    }
  });

  test("(7) floor inheritance: a space-floor folder makes the owner's OWN descendants space-visible, owner-scoped", async () => {
    // The floor folder is published to the space; ANY space member sees it.
    expect(await canSee(fx.cohortStranger.client, fx.floorFolderId)).toBe(true);
    // A's OWN child inside it inherits the floor → space-visible to every member …
    expect(await canSee(fx.cohortStranger.client, fx.floorOwnChildId)).toBe(
      true
    );
    expect(await canSee(fx.grantee.client, fx.floorOwnChildId)).toBe(true);
    // … but ownerB's node merely FILED into the floor folder is NOT broadcast (owner-scope).
    expect(await canSee(fx.cohortStranger.client, fx.floorForeignChildId)).toBe(
      false
    );
    expect(await canSee(fx.grantee.client, fx.floorForeignChildId)).toBe(false);
    // ownerB (its owner) still sees it; only the floor BROADCAST is owner-scoped.
    expect(await canSee(fx.ownerB.client, fx.floorForeignChildId)).toBe(true);
  });

  test('(8) a cohort-shared folder inherits owner-scoped', async () => {
    // The cohort folder is shared with Cohort A; a member of it sees the folder …
    expect(await canSee(fx.cohortMember.client, fx.cohortFolderId)).toBe(true);
    // … and the owner's OWN child inside it, purely via inherited cohort grant.
    expect(await canSee(fx.cohortMember.client, fx.cohortOwnChildId)).toBe(
      true
    );

    // A non-member of Cohort A sees neither (fail-closed) — and the grantee (who has the
    // OTHER folder's per-user grant, not this cohort) does not see the cohort child either.
    expect(await canSee(fx.cohortStranger.client, fx.cohortFolderId)).toBe(
      false
    );
    expect(await canSee(fx.cohortStranger.client, fx.cohortOwnChildId)).toBe(
      false
    );
    expect(await canSee(fx.grantee.client, fx.cohortOwnChildId)).toBe(false);
  });

  test('(9) a `contains` cycle does not hang or over-grant (depth-32 + union guard)', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // Build a small same-owner cycle inside the granted folder: child → cycleA → cycleB,
      // then cycleB → child (closing the loop). All owned by A, all inside the shared folder
      // so they legitimately inherit; the cycle must not change that — and must not hang.
      const a = await ownerClient.createDoc(fx.spaceId, 'Cycle Node A', {
        parentFolderId: fx.sharedFolderId,
      });
      const b = await ownerClient.createDoc(fx.spaceId, 'Cycle Node B', {
        parentFolderId: fx.sharedFolderId,
      });
      // a contains b, b contains a → a 2-cycle on the `contains` relation (same owner).
      await ownerClient.contain(fx.spaceId, a.nodeId, b.nodeId);
      await ownerClient.contain(fx.spaceId, b.nodeId, a.nodeId);

      // The predicate terminates (the test would time out if it looped) and the grantee
      // still sees both (they inherit from the shared folder), with no over-grant.
      expect(await canSee(fx.grantee.client, a.nodeId)).toBe(true);
      expect(await canSee(fx.grantee.client, b.nodeId)).toBe(true);

      // OVER-GRANT guard: a node owned by ownerB inside the SAME cycle is NOT reached — the
      // cycle cannot smuggle a grant across the owner boundary. ownerB grants it to A so A
      // can file it into the cycle, then we confirm the GRANTEE still cannot see it.
      const ownerBClient = await seedClientFor(fx.ownerB);
      try {
        const foreign = await ownerBClient.createDoc(
          fx.spaceId,
          'Cycle Foreign Node',
          {}
        );
        await ownerBClient.grantUser(foreign.nodeId, fx.owner.userId);
        // A files ownerB's node into the cycle (A can see it via the enabling grant).
        await ownerClient.contain(fx.spaceId, a.nodeId, foreign.nodeId);
        // The grantee must NOT see it: owner-scope holds even inside a cycle.
        expect(await canSee(fx.grantee.client, foreign.nodeId)).toBe(false);
      } finally {
        await ownerBClient.dispose();
      }
    } finally {
      await ownerClient.dispose();
    }
  });
});
