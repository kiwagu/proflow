/**
 * Per-person (per-user) sharing access-matrix — (the UI half, slice §8(b)).
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
 * RLS is the SOLE fence: a node a member may not see is
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
 * Plus the co-member identity directory the Share dialog reads, driven AS
 * each actor through the SAME shared `seedClientFor(actor).visibility(...)` vocabulary
 * (the live `GET /author/graph/visibility?q=`) — never an inline fetch or member tree:
 *  (6) the people-picker / "who has access" resolve a CO-member's `display_name`
 *      (NEVER a bare 8-char id) and carry the secondary `email` line.
 *  (7) search (`?q=`) narrows the picker to a member by a name/email fragment; an
 *      empty query returns a bounded starter list of the other members.
 *  (8) a NON-member of the space gets ZERO directory rows (the membership fence) —
 *      asserted from a second, isolated tenant's user under its OWN RLS.
 *
 * DEFERRED — the "Shared by me" lens (DriveScope `shared-by-me`): the
 * owner-direction read of the SAME `per-user-share/granted` grant this fixture already
 * creates (the granter sees the doc the grantee sees via `shared`). Wave 2 a landed only
 * the DATA slice (`SharedByMeEntry` / `KbViewData.sharedByMe`); the lens render + its e2e
 * assertion are the Wave 2 b close-out and will draw from THIS same shared fixture — no new
 * grant, no new tree. Do not duplicate the grant here.
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  seedClientFor,
  seedDirectoryPickerFixture,
  seedPerUserShareFixture,
  teardownKnowledgeGraphTenant,
  type DirectoryPickerFixture,
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

  // ── the co-member identity directory the Share dialog reads ───────────────────
  //
  // The picker + "who has access" resolve OTHER members' display_name + email (the
  // own-row `profiles` SELECT could not). Driven AS each actor through the shared
  // `visibility(...)` vocabulary (GET /author/graph/visibility?q=).

  /** True when `value` is the bare 8-char short-id fallback for `userId` (display
   * name unresolved) — exactly what the directory must NOT render for a co-member. */
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
      // grantable; each resolves to a real display_name (never a short-id). `members`
      // is a keyset PAGE: `items` is this page, `total` the grantable count.
      const picker = await ownerClient.visibility(fx.spaceId, fx.unsharedDocId);
      const byId = new Map(picker.members.items.map((m) => [m.userId, m]));
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
        {
          query: 'Grace',
        }
      );
      expect(byName.members.items.map((m) => m.userId)).toEqual([
        fx.grantee.userId,
      ]);

      // A DISTINCTIVE fragment of the outsider's EMAIL (its ref label, unique among
      // the co-members) narrows to exactly that member — search spans email, not just
      // name. (The shared `seed-per-user-share-…@example.test` prefix would match all;
      // the per-actor label is the discriminator.)
      const emailFragment = 'outsider';
      expect(fx.outsider.email).toContain(emailFragment);
      const byEmail = await ownerClient.visibility(
        fx.spaceId,
        fx.unsharedDocId,
        { query: emailFragment }
      );
      expect(byEmail.members.items.map((m) => m.userId)).toEqual([
        fx.outsider.userId,
      ]);

      // A fragment matching NOBODY returns an empty picker page (still well-formed).
      const none = await ownerClient.visibility(fx.spaceId, fx.unsharedDocId, {
        query: 'zzz-no-such-member-zzz',
      });
      expect(none.members.items).toEqual([]);
      expect(none.members.total).toBe(0);
      expect(none.members.nextCursor).toBeNull();

      // Empty query → the bounded starter list of the OTHER members (owner excluded).
      const starter = await ownerClient.visibility(
        fx.spaceId,
        fx.unsharedDocId,
        { query: '' }
      );
      const starterIds = new Set(starter.members.items.map((m) => m.userId));
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

/**
 * Directory-v2 paginated people-picker — (Wave 1).
 *
 * The Share dialog already has a co-member directory; the suite above proves it on a
 * SMALL (4-member) space — one page holds everyone, so it cannot exercise paging. This suite
 * makes that directory SCALABLE: `space_member_directory` gains a keyset cursor
 * (`p_after`), a windowed `total_count`, and `p_exclude` (owner + already-granted, applied
 * BEFORE the limit AND the count). `GET /author/graph/visibility` accepts `cursor` + `limit`
 * and returns `members` as a PAGE `{ items, nextCursor, total }`; the picker pages 5 by
 * default and shows "+N more" (total − shown) with a "Show more" that appends the next page.
 *
 * The >5-member space comes ENTIRELY from the shared `DIRECTORY_PICKER_SCENARIO` catalog
 * entry (via `seedDirectoryPickerFixture`) — ten grantable co-members + one private share
 * target + one ungranted control, never an inline member tree — so the demo DB and this test
 * build the same cohort the same way. The members carry deterministic "Picker Member NN
 * <Surname>" names whose two-digit ordinal PINS the directory order
 * (`coalesce(display_name,email) asc, user_id asc`), so the keyset walk is unambiguous.
 *
 * Counts are asserted RELATIVE to a live baseline (the control doc's grantable total),
 * never a brittle literal: the ephemeral tenant carries its own base member(s) beyond the
 * ten catalog members, so the page MECHANICS (page-of-5, "+N more", keyset next page, no
 * overlap/gap, p_exclude on grant) — which are total-independent — plus the named-ref
 * exclusions are what we prove, with `total > 5` the only hard invariant (the picker PAGES).
 *
 * Driven through the SAME shared `visibility(...)` vocabulary (the live route with `cursor` +
 * `limit`) — the page-of-5 + "+N more" footer + keyset "Show more" next page + search
 * narrowing + `p_exclude`-on-grant — so the Wave-1 DOM picker spec and this route-level proof
 * speak one create-vocabulary. (The DOM/visual picker assertions land in the workbench spec;
 * here we prove the page shape the dialog renders from.)
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
test.describe('directory-v2 paginated people-picker — @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: DirectoryPickerFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedDirectoryPickerFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        fx?.members
          .map((m) => m.userId)
          .filter((id): id is string => Boolean(id))
      );
    }
  });

  // The fixture seeds TEN catalog members; the ephemeral tenant also carries its base
  // second member (`ungranted`), so the space's grantable directory is > 10 — but the
  // EXACT total is "however many active members minus the excluded set". We assert the
  // page MECHANICS + the named-ref exclusions RELATIVE to a live baseline (the control
  // doc's total), never a brittle literal, so the proof is robust to the base member(s).
  // The only hard invariant we need is total > 5, so the picker genuinely PAGES.

  test('(1) the share target offers a page of 5 + an accurate "+N more" (owner + granted excluded)', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // The control (no grant) is the baseline grantable count for this space; the share
      // target additionally excludes the pre-granted member03 → exactly one fewer.
      const control = await ownerClient.visibility(fx.spaceId, fx.controlDocId);
      const page = await ownerClient.visibility(fx.spaceId, fx.sharedDocId);

      expect(control.members.total).toBeGreaterThan(5); // the directory PAGES
      expect(page.members.total).toBe(control.members.total - 1); // member03 p_excluded
      expect(page.members.items).toHaveLength(5); // default page size
      expect(page.members.nextCursor, 'a next page exists').not.toBeNull();
      // "+N more" the picker shows = total − shown, and it is accurate (> 0 here).
      expect(page.members.total - page.members.items.length).toBeGreaterThan(0);

      // p_exclude: neither the owner NOR the already-granted member appears on the page…
      const pageIds = new Set(page.members.items.map((m) => m.userId));
      expect(pageIds.has(fx.owner.userId)).toBe(false);
      expect(pageIds.has(fx.grantedMember.userId)).toBe(false);
      // …and every offered row resolved to a real display_name (never a short-id).
      for (const m of page.members.items) {
        expect(m.displayName).not.toBe(m.userId.slice(0, 8));
      }
    } finally {
      await ownerClient.dispose();
    }
  });

  test('(2) "Show more" walks the keyset pages — no overlap, no gap, exhausting the total', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // Page through the share target with the default size of 5, re-sending each opaque
      // nextCursor as `cursor` (exactly what the dialog's "Show more" does) until exhausted.
      // `total` is the windowed grantable count — stable across pages — so we capture it
      // from the FIRST page, never an empty trailing page. (NB: `listGrantableMembers`
      // emits a `nextCursor` on a FULL last page even when it exactly exhausts the total —
      // i.e. when `total` is a multiple of the page size — so "Show more" can fetch ONE
      // empty trailing page. That is a benign off-by-one to surface to the picker/fanout
      // owner; the walk stops correctly on the empty page, which adds nothing.)
      const seen: string[] = [];
      let cursor: string | undefined;
      let total = -1;
      let pages = 0;
      for (;;) {
        const res = await ownerClient.visibility(fx.spaceId, fx.sharedDocId, {
          cursor,
        });
        if (pages === 0) total = res.members.total;
        if (res.members.items.length === 0) break; // empty trailing page → stop
        pages += 1;
        for (const m of res.members.items) seen.push(m.userId);
        // A non-null cursor implies the page was FULL (more rows MAY remain).
        if (res.members.nextCursor) {
          expect(res.members.items).toHaveLength(5);
        } else {
          break;
        }
        cursor = res.members.nextCursor;
      }

      // total > 5 ⇒ more than one page; the keyset walk is drift-free: no overlap (each id
      // distinct) and no gap (the union exactly exhausts the reported total).
      expect(total).toBeGreaterThan(5);
      expect(pages).toBeGreaterThan(1);
      expect(new Set(seen).size).toBe(seen.length); // no duplicate across pages
      expect(seen.length).toBe(total); // no gap — the union IS the whole grantable set
      // The already-granted member is absent from EVERY page (p_exclude spans pages).
      expect(seen).not.toContain(fx.grantedMember.userId);
      expect(seen).not.toContain(fx.owner.userId);
      // …and all ten catalog members EXCEPT the pre-granted member03 are reachable.
      for (const m of fx.members) {
        if (m.userId === fx.grantedMember.userId) continue;
        expect(seen).toContain(m.userId);
      }
    } finally {
      await ownerClient.dispose();
    }
  });

  test('(3) the ungranted control offers the FULL cohort (owner-only exclusion)', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // No grant on the control → only the owner is excluded; all ten catalog members are
      // grantable here (member03 included — exclusion is per-resource, not per-space).
      const first = await ownerClient.visibility(fx.spaceId, fx.controlDocId);
      expect(first.members.total).toBeGreaterThan(5);
      expect(first.members.items).toHaveLength(5);
      expect(first.members.nextCursor).not.toBeNull();

      // Walk the rest of the keyset pages (an empty trailing page — possible when the
      // total is a multiple of the page size — contributes nothing and stops the walk).
      const seen = [...first.members.items.map((m) => m.userId)];
      let cursor = first.members.nextCursor ?? undefined;
      while (cursor) {
        const next = await ownerClient.visibility(fx.spaceId, fx.controlDocId, {
          cursor,
        });
        if (next.members.items.length === 0) break;
        for (const m of next.members.items) seen.push(m.userId);
        cursor = next.members.nextCursor ?? undefined;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(first.members.total);
      // member03 (granted on the OTHER doc) IS grantable here — exclusion is per-resource.
      expect(seen).toContain(fx.grantedMember.userId);
      // …and every catalog member is reachable (only the owner is excluded).
      for (const m of fx.members) expect(seen).toContain(m.userId);
    } finally {
      await ownerClient.dispose();
    }
  });

  test('(4) typing narrows the count below a page — "+N more" disappears', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // A distinctive surname fragment (the catalog names carry unique surnames) matches
      // exactly one member → a single-row page, total 1, no next cursor (the "+N more"
      // footer the picker shows collapses).
      const narrowed = await ownerClient.visibility(
        fx.spaceId,
        fx.controlDocId,
        { query: 'Jules' }
      );
      expect(narrowed.members.total).toBe(1);
      expect(narrowed.members.items).toHaveLength(1);
      expect(narrowed.members.nextCursor).toBeNull();
      expect(narrowed.members.items[0]!.displayName).toContain('Jules');
    } finally {
      await ownerClient.dispose();
    }
  });

  test('(5) granting a person drops them from the page AND the total (p_exclude)', async () => {
    const ownerClient = await seedClientFor(fx.owner);
    try {
      // Pick a grantable catalog member from the control's first page (not member03/owner).
      const before = await ownerClient.visibility(fx.spaceId, fx.controlDocId);
      const baseline = before.members.total;
      expect(baseline).toBeGreaterThan(5);
      const target = before.members.items.find(
        (m) =>
          m.userId !== fx.grantedMember.userId &&
          fx.members.some((c) => c.userId === m.userId)
      )!;
      expect(
        target,
        'a grantable catalog member on the first page'
      ).toBeDefined();

      await ownerClient.grantUser(fx.controlDocId, target.userId);
      try {
        // After the grant the directory's total drops by EXACTLY one and the grantee is
        // gone from the page (p_exclude removes the now-granted member at the source).
        const after = await ownerClient.visibility(fx.spaceId, fx.controlDocId);
        expect(after.members.total).toBe(baseline - 1);
        const afterIds = new Set(after.members.items.map((m) => m.userId));
        expect(afterIds.has(target.userId)).toBe(false);
      } finally {
        // Restore the clean slate for re-runnability (idempotent demo content).
        await ownerClient.revokeUser(fx.controlDocId, target.userId);
      }
    } finally {
      await ownerClient.dispose();
    }
  });
});
