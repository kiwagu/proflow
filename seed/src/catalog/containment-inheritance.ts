import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Owner-scoped, live containment access inheritance — ADR-0023.
 *
 * A node is readable if it OR an ANCESTOR folder (up the forward `contains` forest) is
 * granted to the viewer — but OWNER-SCOPED, so the cascade only ever reaches the folder
 * owner's OWN descendants and never a third party's node merely filed into the folder.
 * The grant is a LIVE predicate (a new child auto-appears; a revoke removes the subtree),
 * additive-OR (a child with its own grant survives the folder revoke), and same-owner-only
 * (no admin/curator cross-owner cascade — admins keep EXPLICIT per-node re-share).
 *
 * The worked example — the MINIMAL multi-owner tree that exercises the whole matrix, all
 * in ONE space, every row born the product's way (runtime, under each owner's own RLS via
 * `/author/graph/*` — NEVER a migration seed). Actors:
 *  - `admin`     — Owner A (the folder owner + sharer; base `admin` role, holds access).
 *  - `grantee`   — the person A shares the folder WITH (plain `member`, read+create).
 *  - `ownerB`    — a SECOND owner whose node A files into A's folder (plain `member`).
 *  - `adminC`    — a second `admin` (holds `space.knowledge.access`) who shares a folder
 *                  containing ownerB's node — proving the dropped cross-owner curator branch.
 *  - `cohortMember` / `cohortStranger` — for the cohort-shared-folder inheritance case.
 *
 * The tree (refs):
 *  shared-folder (A, private, shared→grantee)          ← test 1,4,5,6: the granted folder
 *    ├─ own-child       (A) ............................. inherits via the folder grant
 *    ├─ own-grandchild  (A, under a deeper own subfolder) live + deep walk
 *    │    (sub-folder/own-subfolder owned by A)
 *    ├─ foreign-child   (ownerB) ........................ NEGATIVE: owner-scope holds (grantee
 *    │                                                    must NOT see it via the folder grant)
 *    └─ self-granted-child (A, ALSO shared→grantee) ..... test 6: survives the folder revoke
 *
 *  curator-folder (adminC, private, shared→grantee)     ← test 3: no admin cascade
 *    └─ curator-foreign-child (ownerB) ................. NEGATIVE: an admin's folder-share does
 *                                                        NOT expose ownerB's nested node; only
 *                                                        ownerB's OWN explicit grant would.
 *
 *  floor-folder (A, visibility='space')                 ← test 7: floor inheritance, owner-scoped
 *    ├─ floor-own-child   (A) .......................... becomes space-visible via the floor
 *    └─ floor-foreign-child (ownerB) ................... NEGATIVE: not broadcast (owner-scope)
 *
 *  cohort-folder (A, private, scope→cohort-a)           ← test 8: cohort-shared folder inherits
 *    └─ cohort-own-child  (A) .......................... visible to a cohort-a member, owner-scoped
 *
 * The cross-owner nested nodes (`foreign-child`, `curator-foreign-child`, `floor-foreign-child`)
 * are ownerB's, granted to `admin`/`adminC` ONLY so the filer can place them (the edge RETURNING
 * read needs the filer to see both endpoints) — that enabling grant is to the FILER, never to
 * `grantee`, so it cannot taint the owner-scope negatives. The deeper `own-subfolder` proves the
 * recursive walk climbs >1 level on the same-owner spine. The cycle/depth-32 guard is exercised
 * by the e2e directly (it injects a `contains` cycle via the owner's RLS client and asserts the
 * predicate neither hangs nor over-grants) — a cycle is not expressible in the declarative tree.
 *
 * The consuming e2e (`knowledge-containment-inheritance.e2e.spec.ts`) drives the live arcs
 * (new-child / revoke / re-grant) through the SAME `seedClientFor(actor)` create-vocabulary —
 * no inline tree, no hand-built grants.
 */
export const CONTAINMENT_INHERITANCE_SCENARIO: SeedScenario = {
  id: 'containment-inheritance',
  title: 'Containment access inheritance (owner-scoped, live)',
  summary:
    "Sharing a folder makes its OWNER-SCOPED descendants readable to the grantee — live (a new child auto-appears, a revoke removes the subtree), additive-OR (a self-granted child survives the revoke), across per-user / cohort / floor dimensions, but NEVER cross-owner (a third party's nested node, even an admin's folder-share, stays private) (ADR-0023).",
  presets: ['shared'],
  actors: [
    { ref: 'grantee', role: 'member', displayName: 'Folder Grantee' },
    { ref: 'ownerB', role: 'member', displayName: 'Owner Bea' },
    { ref: 'adminC', role: 'admin', displayName: 'Curator Cleo' },
    { ref: 'cohortMember', role: 'member', displayName: 'Cohort Member' },
    { ref: 'cohortStranger', role: 'member', displayName: 'Cohort Stranger' },
  ],
  scopes: [{ ref: 'cohort-a', name: 'Cohort A', members: ['cohortMember'] }],
  tree: [
    // ── the granted folder + its owner-scoped descendants (tests 1,4,5,6) ──────
    {
      ref: 'containment-inheritance/shared-folder',
      kind: 'folder',
      owner: 'admin',
      title: 'Shared Folder',
      description:
        'A folder A shares with the grantee — its own contents inherit.',
      userGrants: ['grantee'],
      children: [
        {
          ref: 'containment-inheritance/own-child',
          kind: 'text',
          owner: 'admin',
          title: 'Own Child Doc',
          description:
            "A's own doc inside the shared folder — inherits the grant.",
          body: prose(
            'I live inside a folder my owner shared with you, so you can read me too — even though no one shared ME with you directly.',
            "That is containment inheritance: a grant on the folder flows down to the owner's own descendants, live. Move me out and the inherited access disappears; that is why privacy is achieved by placement."
          ),
        },
        {
          ref: 'containment-inheritance/own-subfolder',
          kind: 'folder',
          owner: 'admin',
          title: 'Own Subfolder',
          description:
            'A deeper own subfolder — proves the walk climbs >1 level.',
          children: [
            {
              ref: 'containment-inheritance/own-grandchild',
              kind: 'text',
              owner: 'admin',
              title: 'Own Grandchild Doc',
              description:
                'Two levels under the shared folder — the recursive walk reaches it.',
              body: prose(
                'I sit two folders deep under the one that was shared. The inheritance walk climbs the same-owner containment spine all the way up, so a grant on a top folder still reaches me.'
              ),
            },
          ],
        },
        {
          // ALSO shared directly to grantee → survives the folder revoke (additive-OR, test 6).
          ref: 'containment-inheritance/self-granted-child',
          kind: 'text',
          owner: 'admin',
          title: 'Independently Shared Child Doc',
          description:
            'Shared BOTH via the folder AND directly — keeps access after the folder revoke.',
          userGrants: ['grantee'],
          body: prose(
            'I am reachable two ways: through the shared folder, and through my own direct grant to you. Revoke the folder and you still see me — additive-OR means the surviving disjunct wins.'
          ),
        },
      ],
    },

    // ── the admin/curator folder (test 3 — no cross-owner cascade) ─────────────
    {
      ref: 'containment-inheritance/curator-folder',
      kind: 'folder',
      owner: 'adminC',
      title: 'Curator Folder',
      description:
        'A folder owned by an ADMIN (holds access) and shared with the grantee.',
      userGrants: ['grantee'],
    },

    // ── the floor folder (test 7 — floor inheritance, owner-scoped) ────────────
    {
      ref: 'containment-inheritance/floor-folder',
      kind: 'folder',
      owner: 'admin',
      title: 'Floor Folder',
      description:
        'A space-floor folder — its OWN descendants become space-visible; a foreign one does not.',
      visibility: 'space',
      children: [
        {
          ref: 'containment-inheritance/floor-own-child',
          kind: 'text',
          owner: 'admin',
          title: 'Floor Own Child Doc',
          description:
            "A's own doc under a space-floor folder — broadcast to the whole space.",
          body: prose(
            "My folder is published to the whole space, and I am my owner's own content, so I am visible to everyone in the space — placement broadcast me, no per-person grant needed."
          ),
        },
      ],
    },

    // ── the cross-owner nested nodes (top-level so each is created by its own owner
    //    cleanly, then FILED into the right folder via `contains` below) ───────────
    {
      // ownerB's node filed into A's shared folder — granted to `admin` ONLY so A can
      // file it (the edge RETURNING needs the filer to see both endpoints). NOT to grantee.
      ref: 'containment-inheritance/foreign-child',
      kind: 'text',
      owner: 'ownerB',
      title: 'Foreign Child Doc',
      description:
        "Owned by Bea, merely filed into A's shared folder — the grant must NOT reach it.",
      userGrants: ['admin'],
      body: prose(
        'I belong to a different owner; A only filed me into their shared folder. The folder grant is owner-scoped, so it stops at the owner boundary — the grantee never sees me through it.'
      ),
    },
    {
      // ownerB's node inside the admin's folder — granted to adminC ONLY so adminC can file it.
      ref: 'containment-inheritance/curator-foreign-child',
      kind: 'text',
      owner: 'ownerB',
      title: 'Curator Foreign Child Doc',
      description:
        "Bea's node inside an ADMIN's shared folder — still NOT exposed (no admin cascade).",
      userGrants: ['adminC'],
      body: prose(
        'Even though an admin shared the folder I sit in, the implicit cascade is same-owner-only. To share me, the admin must grant ME explicitly — a separate, audited act.'
      ),
    },
    {
      // ownerB's node under A's floor folder — granted to admin ONLY so A can file it.
      ref: 'containment-inheritance/floor-foreign-child',
      kind: 'text',
      owner: 'ownerB',
      title: 'Floor Foreign Child Doc',
      description:
        "Bea's node under A's space-floor folder — NOT broadcast (owner-scope).",
      userGrants: ['admin'],
      body: prose(
        "A space-floor folder broadcasts its owner's OWN descendants, not a third party's node merely filed there. I belong to a different owner, so the floor never broadcasts me."
      ),
    },

    // ── the cohort folder (test 8 — cohort-shared folder inherits) ─────────────
    {
      ref: 'containment-inheritance/cohort-folder',
      kind: 'folder',
      owner: 'admin',
      title: 'Cohort Folder',
      description:
        'A folder shared with Cohort A — its own contents inherit to members.',
      scopes: ['cohort-a'],
      children: [
        {
          ref: 'containment-inheritance/cohort-own-child',
          kind: 'text',
          owner: 'admin',
          title: 'Cohort Own Child Doc',
          description:
            "A's own doc inside a cohort-shared folder — inherits to Cohort A members.",
          body: prose(
            "My folder is shared with a cohort, and I am my owner's own content inside it, so every member of that cohort can read me — the same inheritance, a different conferring dimension."
          ),
        },
      ],
    },

    // ── the NEGATIVE control: a top-level PRIVATE, UN-SHARED admin node ─────────
    // Owned by A, default visibility, NO `userGrants`, NO `scopes`, NO `visibility`
    // override, and NOT placed inside ANY folder (no containment ancestor at all).
    // The access-mirror RENDER invariant (ADR-0023 Wave 2) asserts the NEGATIVE half
    // on this node: it must show NEITHER a "shared out" card badge NOR a shared /
    // inherited summary in the ResourcePanel Access section. Additive-inert: a private
    // unshared admin node is invisible to everyone but `admin`, so it changes no
    // existing visibility-matrix outcome.
    {
      ref: 'containment-inheritance/private-unshared',
      kind: 'text',
      owner: 'admin',
      title: 'Private Unshared Doc',
      description:
        'A top-level private doc A never shared and never filed into a shared folder — the render NEGATIVE.',
      body: prose(
        'I am private and unshared: no one was granted me, no cohort scopes me, and I sit at the top of the tree with no folder above me to inherit from.',
        'So the Access section must stay silent — no "shared out" badge, no shared-with or inherited-from summary. I am the negative control that proves the access-mirror render does not invent access where none exists.'
      ),
    },
  ],
  // Cross-owner filing: each foreign node (ownerB's) is placed into the relevant folder by
  // an actor that can see BOTH endpoints — the folder owner who also holds the enabling grant
  // the foreign node's owner authored (`userGrants` above). This is the real-world fact
  // ADR-0023 §Context cites (A files B's node) — and the owner-scope rule makes those nested
  // foreign nodes the negatives the matrix proves are NOT exposed by the folder grant.
  contains: [
    // A files ownerB's node into A's shared folder (A sees both: owns folder + the grant).
    {
      folder: 'containment-inheritance/shared-folder',
      child: 'containment-inheritance/foreign-child',
      by: 'admin',
    },
    // adminC files ownerB's node into adminC's folder (adminC sees both: owns folder + grant).
    {
      folder: 'containment-inheritance/curator-folder',
      child: 'containment-inheritance/curator-foreign-child',
      by: 'adminC',
    },
    // A files ownerB's node into A's floor folder (A sees both: owns folder + the grant).
    {
      folder: 'containment-inheritance/floor-folder',
      child: 'containment-inheritance/floor-foreign-child',
      by: 'admin',
    },
  ],
};
