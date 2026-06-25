import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Per-user (per-person) sharing — the THIRD additive grant dimension (ADR-0019).
 * Beyond the broadcast floor (private/space) and cohort grants, an owner can share
 * ONE resource with ONE named space member, widening just that person's READ
 * visibility on a `private`-floor node. It is additive and fail-closed: granting
 * never fences, revoking narrows back, and an un-granted third member stays blind.
 *
 * The worked example — one owner (`admin`), one private doc, four audiences:
 *  - `grantee` — a member the doc is shared WITH per-person: sees it via the grant;
 *  - `outsider` — a member with NO grant: the doc stays invisible (fail-closed);
 *  - `bystander` — a plain `member` (no `space.knowledge.access` verb): proves a
 *    non-owner non-access-manager CANNOT grant/revoke (the authority-negative case);
 *  - the owner — always sees its own private content.
 *
 * Authority to grant/revoke is owner-sovereign OR a space access-manager
 * (`space.knowledge.access`); the grantee must be an active member of the doc's
 * space (a same-space DB guard). This scenario CREATES that grant through the live
 * Share transport (`POST /author/graph/visibility` with `grantType: 'user'`), so
 * the demo DB and the access-matrix e2e draw from one create-vocabulary. Resolving
 * it AS each actor (grantee sees / outsider blind / revoke narrows / re-grant
 * restores / cross-space rejected / non-owner cannot grant) is what the access-matrix
 * e2e proves — the catalog gives it every actor + the named refs; the revoke/re-grant
 * arc is driven through the shared `grantUser` / `revokeUser` vocabulary. Here the
 * seeded grant stands as the demo + the learning material.
 *
 * The space is deliberately MULTI-MEMBER (owner + grantee + outsider + bystander),
 * each carrying a real `displayName`, so the SAME fixture also exercises the co-member
 * identity directory (ADR-0020): the Share dialog people-picker + "who has access"
 * rows resolve a CO-member's `display_name` (never a bare short-id), search (`?q=`)
 * narrows the picker by a name/email fragment, and a non-member of the space gets an
 * empty directory (the membership fence). The display names are authored through each
 * actor's OWN profile (own-row RLS), exactly as a member would set theirs.
 *
 * BOTH directions of the grant graph from ONE create-vocabulary (ADR-0021 Part B).
 * The SAME `per-user-share/granted` grant — created exactly once, as the owner (`admin`)
 * sharing OUT to `grantee` — is read from two opposite ends:
 *  - the GRANTER (`admin`) sees the doc in the "Shared by me" lens (`'shared-by-me'`
 *    DriveScope): the resources I have shared OUT, a READ-ONLY projection over
 *    `knowledge_resource_user_grants WHERE granted_by = me`, returned as `SharedByMeEntry`
 *    (`{ resourceId, grantees }`) — here `resourceId` = `per-user-share/granted`, with
 *    `grantee` (Grace Granger) as the sole grantee, labelled via the co-member directory.
 *  - the GRANTEE (`grantee`) sees the SAME doc in the "Shared with me" lens (`'shared'`
 *    DriveScope): the resources shared INTO my visibility.
 * The sibling `per-user-share/unshared` (no grant) appears in NEITHER lens — fail-closed
 * by construction: no grant row means no "Shared by me" entry and no "Shared with me"
 * visibility. So this one fixture is the worked example for BOTH owner- and grantee-side
 * sharing lenses. (Wave 2 a landed only the `'shared-by-me'` DATA slice — the SSR-seeded
 * `KbViewData.sharedByMe`; the lens render/switcher and its e2e assertion are the Wave 2 b
 * close-out, so this scenario already carries the data those assertions will draw from.)
 */
export const PER_USER_SHARE_SCENARIO: SeedScenario = {
  id: 'per-user-share',
  title: 'Per-person sharing',
  summary:
    'A private doc shared with ONE named member (a per-user grant): the grantee sees it in "Shared with me" (DriveScope `shared`), the owner sees it in "Shared by me" (DriveScope `shared-by-me`, a SharedByMeEntry over the same grant), a third un-granted member stays blind — additive, fail-closed (ADR-0019, ADR-0021 Part B). Named co-members feed the Share people-picker directory (ADR-0020).',
  presets: ['per-user-share'],
  actors: [
    // Distinct display names so the co-member directory (ADR-0020) resolves a real
    // name in the picker / "who has access" rows, and search can narrow by a fragment.
    { ref: 'grantee', role: 'admin', displayName: 'Grace Granger' },
    { ref: 'outsider', role: 'admin', displayName: 'Otis Outerly' },
    // A plain member (no knowledge.access verb) — the authority-negative actor: it
    // is neither owner nor access-manager, so its grant/revoke attempt must be denied.
    { ref: 'bystander', role: 'member', displayName: 'Bobby Bystand' },
  ],
  tree: [
    {
      ref: 'per-user-share/folder',
      kind: 'folder',
      title: 'Per-Person Sharing',
      description: 'A private doc shared directly with one named teammate.',
      // The folder stays private (its visibility is the owner's); the per-user
      // grant is on the doc inside it — the named member's read widens to the doc.
      children: [
        {
          ref: 'per-user-share/granted',
          kind: 'text',
          title: 'Shared with one person (per-user grant)',
          // floor=private (default) + ONE additive per-user grant to `grantee`.
          // No cohort, no space publish — the grant is the SOLE widening disjunct.
          // This ONE grant is the worked example for BOTH sharing lenses (ADR-0021 Part B):
          //  - owner (`admin`) reads it via "Shared by me" (DriveScope `shared-by-me`) — the
          //    `SharedByMeEntry` for THIS resourceId, with `grantee` as the sole grantee;
          //  - `grantee` reads the SAME doc via "Shared with me" (DriveScope `shared`).
          // Do NOT add a parallel grant for the opposite direction — both lenses read this row.
          userGrants: ['grantee'],
          body: prose(
            'This note is private, then shared with exactly one teammate by name.',
            'The grantee sees it through the per-user grant — a direct, additive act on top of the private floor. A third member with no grant cannot see it at all (fail-closed). The owner sees this same grant from the other side, in the "Shared by me" lens.',
            'Revoking the grant narrows access back to the owner alone, non-destructively — and the doc drops out of BOTH lenses at once. Only the owner (or a space access-manager) may grant or revoke.'
          ),
        },
        {
          ref: 'per-user-share/unshared',
          kind: 'text',
          title: 'Not shared with anyone (owner only)',
          // The control: a private sibling with NO per-user grant — neither the
          // grantee NOR the outsider can see it. Proves the grant is per-resource.
          body: prose(
            'This sibling note carries no per-user grant. Neither teammate can see it — sharing is always a deliberate, per-resource act, never inherited from a neighbour.'
          ),
        },
      ],
    },
  ],
};
