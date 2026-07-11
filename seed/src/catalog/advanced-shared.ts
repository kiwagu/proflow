import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Tariff-gated ADVANCED (structural) view of the Shared lenses.
 *
 * The two Shared lenses (`'shared'` = "Shared with me" = visible nodes I do NOT own;
 * `'shared-by-me'` = the resources I have shared OUT) ship FLAT (a digest). This scenario
 * adds an ADVANCED display mode that renders the SAME RLS-visible shared node-set as
 * the KB containment TREE, gated by the COMMERCIAL `advanced_shared_view` entitlement
 * (a scoped control-plane `runtime_settings` row, resolved global→org→space with
 * org∧space AND-composition). It is VIEW-ONLY: the advanced view shows EXACTLY the
 * flat view's nodes — only the layout differs — so the gate is an ENTITLEMENT, never a
 * security boundary (RLS is untouched; the same node-set renders in both modes, the
 * advanced tree just reuses `buildContainment` over the shared subset + the already-
 * loaded `contains` forest — NO new data model, NO resolver change, Invariant #1).
 *
 * The worked example — the MINIMAL tree that demonstrates the structural view, all
 * owned by `admin` and published to the SPACE FLOOR so a NON-OWNING member sees them in
 * its "Shared with me" lens (a two-member space → a floor publish is "shared with me"):
 *  - `advanced-shared/folder` — a folder published to the floor, that CONTAINS
 *    `advanced-shared/nested` (also published) → in the ADVANCED tree the nested doc
 *    NESTS UNDER the folder (both are in the shared set, so the containment edge holds);
 *  - `advanced-shared/private-parent` — a folder that stays PRIVATE (unpublished), that
 *    contains `advanced-shared/orphan` (published) → the orphan's containing folder is
 *    NOT in the viewer's shared set, so in the advanced tree the orphan appears at the
 *    ROOT (graceful-absence: no synthetic ancestor folder is fabricated for it).
 *
 * So the advanced tree over the shared set is exactly: folder ⊃ nested-child, plus
 * orphan-at-root — the same three nodes the flat digest lists, re-arranged structurally.
 * (The fourth node, the private parent, is invisible to the viewer — it never enters the
 * shared set — which is precisely what makes its child an orphan-at-root.)
 *
 * Everything is born the product's way (runtime, under the owner's own RLS — NEVER a
 * migration seed, which poisons the author identity-sync worker): the folders/docs via
 * `/author/graph/*`, the containment via `contain`, the floor publish via `setFloor`.
 * The COMMERCIAL entitlement rows are control-plane config (a service-role
 * `runtime_settings` upsert), out of scope for a CONTENT scenario — the consuming e2e
 * sets them via its own `setAdvancedSharedEntitlement` helper; this fixture only builds
 * the RLS-visible shared node-set both display modes render.
 */
export const ADVANCED_SHARED_SCENARIO: SeedScenario = {
  id: 'advanced-shared',
  title: 'Advanced shared view (structural)',
  summary:
    'The tariff-gated ADVANCED (tree) layout of the Shared lenses over the SAME RLS-visible shared set as the flat digest: a shared folder ⊃ a shared doc that NESTS under it, plus a doc whose parent folder is NOT shared so it sits at the ROOT (graceful-absence) — view-only, entitlement-gated, no resolver change (Invariant #1).',
  presets: ['shared'],
  tree: [
    {
      // The shared CONTAINER: published to the floor so the non-owning viewer sees the
      // folder itself in its shared set → in the advanced tree it gains an expand
      // control for its nested shared child.
      ref: 'advanced-shared/folder',
      kind: 'folder',
      owner: 'admin',
      title: 'Shared Folder',
      description:
        'A shared folder whose shared child nests under it in the tree.',
      visibility: 'space',
      children: [
        {
          // The NESTED shared doc: a flat sibling in the digest, but in the advanced
          // tree it NESTS under its shared parent folder (both are in the shared set).
          ref: 'advanced-shared/nested',
          kind: 'text',
          owner: 'admin',
          title: 'Nested Shared Doc',
          description:
            'Lives inside the shared folder — nests under it in the tree.',
          visibility: 'space',
          body: prose(
            'This note lives inside a shared folder, and the folder is shared with you too.',
            'In the flat digest it is just one row among the shared nodes. In the advanced (structural) view it nests UNDER its folder — the containment edge holds because both the folder and this note are in your shared set.',
            'Same node, same access — only the layout changes. The advanced view is a display upgrade, never a different set of content.'
          ),
        },
      ],
    },
    {
      // The PRIVATE parent: NOT published (private floor by default), so the non-owning
      // viewer cannot see it → it never enters the shared set. Its published child below
      // therefore has no SHARED ancestor and roots in the advanced tree.
      ref: 'advanced-shared/private-parent',
      kind: 'folder',
      owner: 'admin',
      title: 'Private Parent',
      description:
        'Stays private — invisible to the viewer, so its published child is an orphan at the root.',
      children: [
        {
          // The ORPHAN-AT-ROOT doc: published (the viewer sees it), but its containing
          // folder is private (the viewer does NOT see it). In the advanced tree it
          // appears at the ROOT — graceful-absence, no synthetic ancestor is fabricated.
          ref: 'advanced-shared/orphan',
          kind: 'text',
          owner: 'admin',
          title: 'Orphan Shared Doc',
          description:
            'Published, but its parent folder is private — so it sits at the root of the shared tree.',
          visibility: 'space',
          body: prose(
            'This note is shared with you, but the folder it lives in is NOT — its parent stays private to its owner.',
            'In the advanced (structural) view, a shared node whose containing folder is absent from your shared set appears at the ROOT of the tree. The product never fabricates a synthetic ancestor for a folder you cannot see — graceful absence over a misleading placeholder.',
            'So this note sits at the top level of your shared tree, right alongside the shared folder, even though it physically lives one level down in a folder you cannot see.'
          ),
        },
      ],
    },
  ],
};
