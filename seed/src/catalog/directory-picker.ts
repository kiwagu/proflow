import { prose } from './lexical.js';
import type { ActorSpec, SeedScenario } from './types.js';

/**
 * Directory-v2 picker cohort — a space LARGE ENOUGH to exercise the paginated
 * co-member people-picker (decisions A1/A2/A5).
 *
 * The Share dialog already has a searchable co-member directory; the
 * `per-user-share` scenario seeds the small (4-member) directory that proves
 * resolve-a-name / search-narrows / non-member-is-blind. This scenario makes that
 * directory *scalable*: `space_member_directory` gains a keyset cursor
 * (`p_after_key,p_after_user`), a windowed `total_count`, and `p_exclude` (owner +
 * already-granted, removed BEFORE the page limit and the count). The picker pages 5
 * at a time, shows "+N more", and a "Show more" affordance fetches the NEXT keyset
 * page. A 4-member space cannot demonstrate any of that (one page of ≤4 holds them
 * all). This scenario seeds the cohort that CAN.
 *
 * The worked example — one owner (`admin`) + a comfortable cohort of TEN active,
 * grantable co-members, all sharing ONE space, plus ONE private knowledge resource
 * (`directory-picker/shared`) owned by `admin` as the Share target:
 *  - >5 grantable members, so the page-of-5 picker shows 5 rows + a "+N more"
 *    footer (total > 5) and a "Show more" that fetches the next keyset page;
 *  - the keyset "load more" fetches the NEXT distinct page with NO overlap and NO
 *    gap (the stable order is `coalesce(display_name, email) asc, user_id asc`, a
 *    strict total order — the cursor is an exact row-comparison seek);
 *  - ONE member (`picker-member-03`) is pre-granted the share target, so `p_exclude`
 *    (owner + already-granted) must drop BOTH the owner AND that grantee from the
 *    page AND from the `total_count` — i.e. 10 members − owner(0, not a member here)
 *    − 1 granted = 9 grantable, total = 9, a full first page of 5, a second page of
 *    the remaining 4.
 *
 * Deterministic ordering: every member carries a distinct `display_name` of the form
 * "Picker Member NN <Surname>" whose two-digit ordinal makes the directory's
 * `coalesce(display_name, email)` sort UNAMBIGUOUS across the page-of-5 boundary — so
 * the e2e can assert the exact first-page set and the exact next-page set with no
 * tie-break ambiguity. The owner (`admin`) has its own profile name; it is the share
 * target's owner, so it is excluded from its OWN grantable directory by `p_exclude`.
 *
 * Everything is born the product's way (runtime, under RLS): the members are minted
 * as active space members through the materializer's actor path (NEVER a migration
 * seed — that poisons the author identity-sync worker), their `display_name`s are set
 * through each actor's OWN-row profile update (exactly as a member would), and the one
 * pre-existing grant is authored through the live Share transport
 * (`POST /author/graph/visibility`, grantType:'user') via the scenario's `userGrants`.
 *
 * The Wave-1b picker e2e (the render agent's close-out) draws this >5-member grantable
 * space ENTIRELY from this catalog entry via `materializeFixture`/`seedClientFor` and
 * the `seedDirectoryPickerFixture` helper — never an inline member tree — and asserts
 * the page / "+N more" / "Show more" / `p_exclude` behaviour against the named refs.
 */

/** Ten grantable co-members, deterministically sortable by display name. The
 * two-digit ordinal pins the directory order (`coalesce(display_name,email) asc`) so
 * the page-of-5 boundary is unambiguous for keyset-page assertions. Distinct surnames
 * also give a search (`?q=`) fragment that matches exactly one member. */
const PICKER_MEMBERS: ActorSpec[] = [
  {
    ref: 'picker-member-01',
    role: 'member',
    displayName: 'Picker Member 01 Avery',
  },
  {
    ref: 'picker-member-02',
    role: 'member',
    displayName: 'Picker Member 02 Blake',
  },
  {
    ref: 'picker-member-03',
    role: 'member',
    displayName: 'Picker Member 03 Casey',
  },
  {
    ref: 'picker-member-04',
    role: 'member',
    displayName: 'Picker Member 04 Drew',
  },
  {
    ref: 'picker-member-05',
    role: 'member',
    displayName: 'Picker Member 05 Emery',
  },
  {
    ref: 'picker-member-06',
    role: 'member',
    displayName: 'Picker Member 06 Frankie',
  },
  {
    ref: 'picker-member-07',
    role: 'member',
    displayName: 'Picker Member 07 Greer',
  },
  {
    ref: 'picker-member-08',
    role: 'member',
    displayName: 'Picker Member 08 Harlow',
  },
  {
    ref: 'picker-member-09',
    role: 'member',
    displayName: 'Picker Member 09 Indigo',
  },
  {
    ref: 'picker-member-10',
    role: 'member',
    displayName: 'Picker Member 10 Jules',
  },
];

export const DIRECTORY_PICKER_SCENARIO: SeedScenario = {
  id: 'directory-picker',
  title: 'Directory-v2 picker cohort',
  summary:
    'A space with TEN grantable co-members + one private share target, so the paginated people-picker can demonstrate a page of 5 + "+N more", a keyset "Show more" next page with no overlap, and p_exclude dropping the owner + already-granted from both the page and the count.',
  presets: ['per-user-share'],
  actors: PICKER_MEMBERS,
  tree: [
    {
      ref: 'directory-picker/folder',
      kind: 'folder',
      title: 'Directory Picker Cohort',
      description:
        'A private doc whose Share dialog picks from a ten-member co-member directory.',
      children: [
        {
          ref: 'directory-picker/shared',
          kind: 'text',
          title: 'Share target (ten-member picker)',
          // floor=private (default). The Share dialog's grantable directory for THIS
          // node is the space's active members minus the owner (`admin`, p_exclude)
          // and minus anyone already granted (`picker-member-03` below, p_exclude) —
          // so the picker shows 9 grantable, paged 5 + 4 with "+N more".
          userGrants: ['picker-member-03'],
          body: prose(
            "This note is private. Its Share dialog opens a people-picker over the space's ten co-members.",
            'Because the cohort is larger than one page, the picker shows the first 5 by the directory order, a "+N more" count of the rest, and a "Show more" control that fetches the next keyset page — with no overlap and no gap.',
            'The owner and anyone already shared with are excluded from BOTH the page and the count (p_exclude), so every row offered is a real, new grantable candidate.'
          ),
        },
        {
          ref: 'directory-picker/control',
          kind: 'text',
          title: 'Ungranted sibling (picker control)',
          // A private control with NO grant — its picker offers the FULL grantable
          // set (owner excluded only), i.e. all ten members across two pages.
          body: prose(
            'A private sibling with no grant yet. Its Share picker offers the entire ten-member cohort (only the owner is excluded), so it demonstrates a full first page plus a "Show more" next page from a clean slate.'
          ),
        },
      ],
    },
  ],
};

/** Member ref → its deterministic display name, in directory sort order. The Wave-1b
 * picker e2e asserts the first keyset page (rows 1–5) and the next page (rows 6–9,
 * with `picker-member-03` removed by `p_exclude`) against THESE names. Kept in sync
 * with `PICKER_MEMBERS`. */
export const DIRECTORY_PICKER_DISPLAY_NAMES: Record<string, string> =
  Object.fromEntries(
    PICKER_MEMBERS.map((m) => [m.ref, m.displayName as string])
  );
