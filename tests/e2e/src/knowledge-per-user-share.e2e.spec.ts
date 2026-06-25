/**
 * Per-person (per-user) sharing access-matrix — ADR-0019 (the UI half, slice §8(b)).
 *
 * Proves the THIRD additive grant dimension: beyond the broadcast floor and cohort
 * grants, an owner shares ONE private resource with ONE named space member, widening
 * just that person's READ visibility. It is additive and fail-closed — granting never
 * fences, revoking narrows back, and an un-granted third member stays blind.
 *
 * The whole tree + the seeded grant come from the SHARED `PER_USER_SHARE_SCENARIO`
 * catalog entry (via `seedPerUserShareFixture`), so the demo DB and this test build the
 * grant through the ONE Share transport (`POST /author/graph/visibility`,
 * grantType:'user'). The revoke/re-grant arc is driven through the SAME shared
 * vocabulary (`seedClientFor(owner).revokeUser` / `.grantUser`) — no inline
 * create/delete helpers, no hand-built tree.
 *
 * RLS is the SOLE fence (ADR-0017 §1.5 + ADR-0019): a node a member may not see is
 * ABSENT from a direct `knowledge_resources` select under that member's RLS client —
 * never returned with a flag. So `canSee` = "the row comes back under your own JWT".
 *
 * Coverage (the matrix the fixture supports):
 *  (1) grant makes a private node visible to exactly one other member; the owner and
 *      the grantee see it, a third un-granted member (outsider) does NOT.
 *  (2) the control sibling (no grant) is invisible to BOTH non-owners — sharing is
 *      per-resource, never inherited from a neighbour.
 *  (3) revoke hides it (grantee loses sight, owner keeps it); re-grant restores it.
 *  (4) authority: a non-owner non-access-manager (`bystander`, a plain member) cannot
 *      grant — the Share POST is rejected (no fence raised, clean 4xx) and confers
 *      no visibility.
 *  (5) cross-space: granting to a user who is NOT a member of the resource's space is
 *      rejected (the same-space DB guard), and confers no visibility.
 *
 * Plus the co-member identity directory the Share dialog reads (ADR-0020), driven AS
 * each actor through the SAME shared `seedClientFor(actor).visibility(...)` vocabulary
 * (the live `GET /author/graph/visibility?q=`) — never an inline fetch or member tree:
 *  (6) the people-picker / "who has access" resolve a CO-member's `display_name`
 *      (NEVER a bare 8-char id) and carry the secondary `email` line.
 *  (7) search (`?q=`) narrows the picker to a member by a name/email fragment; an
 *      empty query returns a bounded starter list of the other members.
 *  (8) a NON-member of the space gets ZERO directory rows (the membership fence) —
 *      asserted from a second, isolated tenant's user under its OWN RLS.
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  seedClientFor,
  seedPerUserShareFixture,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type PerUserShareFixture,
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

test.describe('per-user (per-person) sharing — access matrix @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: PerUserShareFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedPerUserShareFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        [fx?.grantee.userId, fx?.outsider.userId, fx?.bystander.userId].filter(
          (id): id is string => Boolean(id)
        )
      );
    }
  });

  test('(1) grant makes a private node visible to exactly one other member', async () => {
    // Owner always sees its own private content.
    expect(await canSee(fx.owner.client, fx.grantedDocId)).toBe(true);
    // The grantee sees it via the seeded per-user grant.
    expect(await canSee(fx.grantee.client, fx.grantedDocId)).toBe(true);
    // A third un-granted member stays blind (fail-closed) — the grant is to ONE person.
    expect(await canSee(fx.outsider.client, fx.grantedDocId)).toBe(false);
  });

  test('(2) the control sibling (no grant) is invisible to both non-owners', async () => {
    expect(await canSee(fx.owner.client, fx.unsharedDocId)).toBe(true);
    // Sharing is per-resource — neither teammate inherits it from the granted sibling.
    expect(await canSee(fx.grantee.client, fx.unsharedDocId)).toBe(false);
    expect(await canSee(fx.outsider.client, fx.unsharedDocId)).toBe(false);
  });

  test('(3) revoke hides it; re-grant restores it', async () => {
    const ownerClient = await seedClientFor(fx.owner);

    // Revoke through the shared vocabulary (DELETE /author/graph/visibility,
    // grantType:'user') — narrows the grantee's read back to nothing.
    await ownerClient.revokeUser(fx.grantedDocId, fx.grantee.userId);
    expect(await canSee(fx.grantee.client, fx.grantedDocId)).toBe(false);
    // Non-destructive: the owner still sees its own content.
    expect(await canSee(fx.owner.client, fx.grantedDocId)).toBe(true);

    // Re-grant restores visibility — additive, repeatable, idempotent in effect.
    await ownerClient.grantUser(fx.grantedDocId, fx.grantee.userId);
    expect(await canSee(fx.grantee.client, fx.grantedDocId)).toBe(true);

    await ownerClient.dispose();
  });

  test('(4) authority: a non-owner non-access-manager cannot grant', async () => {
    const bystanderClient = await seedClientFor(fx.bystander);

    // `bystander` is a plain member: neither owner nor access-manager. Its Share POST
    // is rejected by RLS/the D9 trigger (a clean 4xx, no fence) — `grantUser` asserts
    // 201 and so throws on the rejection.
    await expect(
      bystanderClient.grantUser(fx.grantedDocId, fx.outsider.userId)
    ).rejects.toThrow();

    // …and it conferred no visibility: the outsider is still blind.
    expect(await canSee(fx.outsider.client, fx.grantedDocId)).toBe(false);

    await bystanderClient.dispose();
  });

  test('(5) cross-space: granting to a non-member of the space is rejected', async () => {
    // A user from a SECOND, fully isolated tenant — not a member of fx's space.
    const otherTenant = await bootstrapKnowledgeGraphTenant();
    try {
      const stranger: KnowledgeActor = otherTenant.granted;
      const ownerClient = await seedClientFor(fx.owner);

      // The same-space DB guard rejects a grant to a non-member of the resource's
      // space (a clean 4xx, no fence) — `grantUser` throws on the non-201.
      await expect(
        ownerClient.grantUser(fx.grantedDocId, stranger.userId)
      ).rejects.toThrow();

      // No visibility leaked across the space boundary.
      expect(await canSee(stranger.client, fx.grantedDocId)).toBe(false);

      await ownerClient.dispose();
      await teardownKnowledgeGraphTenant(otherTenant);
    } catch (err) {
      await teardownKnowledgeGraphTenant(otherTenant);
      throw err;
    }
  });

  // ── ADR-0020: the co-member identity directory the Share dialog reads ─────────
  //
  // The picker + "who has access" resolve OTHER members' display_name + email (the
  // own-row `profiles` SELECT could not). Driven AS each actor through the shared
  // `visibility(...)` vocabulary (GET /author/graph/visibility?q=).

  /** True when `value` is the bare 8-char short-id fallback for `userId` (display
   * name unresolved) — exactly what ADR-0020 must NOT render for a co-member. */
  const isShortId = (value: string, userId: string): boolean =>
    value === userId.slice(0, 8);

  test('(6) the picker + "who has access" resolve a co-member display_name (not a short-id)', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // "Who has access" — the granted doc carries one per-user grant (grantee).
      const granted = await ownerClient.visibility(fx.spaceId, fx.grantedDocId);
      const grant = granted.grants.find((g) => g.userId === fx.grantee.userId);
      expect(grant, 'grantee appears in who-has-access').toBeDefined();
      expect(grant!.displayName).toBe(fx.displayNames.grantee);
      // The directory resolved a real NAME, not the short-id fallback.
      expect(isShortId(grant!.displayName, fx.grantee.userId)).toBe(false);
      // …and carries the secondary email disambiguator line.
      expect(grant!.email).toBe(fx.grantee.email);

      // People-picker — the control sibling has NO grants, so every other member is
      // grantable; each resolves to a real display_name (never a short-id).
      const picker = await ownerClient.visibility(fx.spaceId, fx.unsharedDocId);
      const byId = new Map(picker.members.map((m) => [m.userId, m]));
      for (const co of [fx.grantee, fx.outsider, fx.bystander]) {
        const member = byId.get(co.userId);
        expect(member, `${co.userId} grantable`).toBeDefined();
        expect(isShortId(member!.displayName, co.userId)).toBe(false);
        expect(member!.email).toBe(co.email);
      }
      // The owner is excluded from its own picker (cannot grant to itself).
      expect(byId.has(fx.owner.userId)).toBe(false);
    } finally {
      await ownerClient.dispose();
    }
  });

  test('(7) search narrows the picker by a name/email fragment; empty query is a bounded starter list', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // A fragment of the grantee's NAME narrows to exactly that member.
      const byName = await ownerClient.visibility(
        fx.spaceId,
        fx.unsharedDocId,
        'Grace'
      );
      expect(byName.members.map((m) => m.userId)).toEqual([fx.grantee.userId]);

      // A DISTINCTIVE fragment of the outsider's EMAIL (its ref label, unique among
      // the co-members) narrows to exactly that member — search spans email, not just
      // name. (The shared `seed-per-user-share-…@example.test` prefix would match all;
      // the per-actor label is the discriminator.)
      const emailFragment = 'outsider';
      expect(fx.outsider.email).toContain(emailFragment);
      const byEmail = await ownerClient.visibility(
        fx.spaceId,
        fx.unsharedDocId,
        emailFragment
      );
      expect(byEmail.members.map((m) => m.userId)).toEqual([
        fx.outsider.userId,
      ]);

      // A fragment matching NOBODY returns an empty picker (still well-formed).
      const none = await ownerClient.visibility(
        fx.spaceId,
        fx.unsharedDocId,
        'zzz-no-such-member-zzz'
      );
      expect(none.members).toEqual([]);

      // Empty query → the bounded starter list of the OTHER members (owner excluded).
      const starter = await ownerClient.visibility(
        fx.spaceId,
        fx.unsharedDocId,
        ''
      );
      const starterIds = new Set(starter.members.map((m) => m.userId));
      expect(starterIds.has(fx.grantee.userId)).toBe(true);
      expect(starterIds.has(fx.outsider.userId)).toBe(true);
      expect(starterIds.has(fx.bystander.userId)).toBe(true);
      expect(starterIds.has(fx.owner.userId)).toBe(false);
    } finally {
      await ownerClient.dispose();
    }
  });

  test('(8) a non-member of the space gets zero directory rows (the membership fence)', async () => {
    // A user from a SECOND, fully isolated tenant — not a member of fx's space.
    const otherTenant = await bootstrapKnowledgeGraphTenant();
    try {
      const stranger: KnowledgeActor = otherTenant.granted;
      // The directory RPC is gated by the CALLER's own active membership of the
      // space (security-definer, fenced inside the body). A non-member resolving the
      // SAME space sees an empty directory: zero rows, under its own RLS.
      const { data, error } = await stranger.client.rpc(
        'space_member_directory',
        { p_space_id: fx.spaceId, p_query: undefined, p_limit: 50 }
      );
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      await teardownKnowledgeGraphTenant(otherTenant);
    } catch (err) {
      await teardownKnowledgeGraphTenant(otherTenant);
      throw err;
    }
  });
});
