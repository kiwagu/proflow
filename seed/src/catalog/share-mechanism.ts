import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * "Shared with me" MECHANISM DISTINCTION — ADR-0021 Part C (the DATA layer landed in
 * Wave 3a; this scenario is the SHARED fixture the Wave 3b render/badge e2e draws from).
 *
 * In the `'shared'` lens (visible nodes I do NOT own) every node carries the single
 * WINNING mechanism that grants ME — the `viewer` — access, with precedence
 * `personal > cohort > broadcast`:
 *  - `personal`  — a per-user grant TO me (`knowledge_resource_user_grants`, ADR-0019);
 *  - `cohort`    — a cohort grant to a cohort I belong to (`knowledge_resource_scopes`
 *                  ⋈ `scope_memberships`, ADR-0017);
 *  - `broadcast` — the residual: visible via the space/org floor OR the supervisory
 *                  hierarchy (folded into broadcast for v1).
 *
 * The worked example — ONE space, ONE non-owner `viewer` (a plain `member`), and FOUR
 * nodes ALL owned by a DIFFERENT member (`owner`, so owner ≠ viewer → every node is in
 * the viewer's `'shared'` lens), one per mechanism plus the precedence case:
 *  - `share-mechanism/personal`  — owner shares it with `viewer` by a per-user grant
 *                                  → annotates `personal`;
 *  - `share-mechanism/cohort`    — owner fences it to the `mech-cohort` cohort that
 *                                  `viewer` belongs to → annotates `cohort`;
 *  - `share-mechanism/broadcast` — owner publishes it to the SPACE FLOOR
 *                                  (`visibility='space'`) → annotates `broadcast`;
 *  - `share-mechanism/both`      — owner BOTH per-user-grants `viewer` AND cohort-fences
 *                                  it → must annotate `personal` (precedence test).
 *
 * The three roles the fixture exposes:
 *  - `owner` (admin) — owns all four nodes and authors each node's OWN grant
 *    (per-user grant + cohort link) under its own RLS, owner-sovereign;
 *  - `viewer` (member) — the single non-owner grantee; sees all four in `'shared'`,
 *    and the annotation tells it WHICH mechanism admits each;
 *  - `access-manager` (the built-in `admin`) — holds `space.knowledge.access`, creates
 *    the `mech-cohort` cohort and enrols `viewer` into it (the cohort membership write).
 *
 * Everything is born the product's way (runtime, under each actor's own RLS — NEVER a
 * migration seed, which poisons the author identity-sync worker): the per-user grants
 * via the live Share transport (`POST /author/graph/visibility`, grantType:'user') from
 * the owner; the cohort + membership via the access-manager; the floor publish via the
 * owner's `setFloor`. The annotation itself (`annotateShareMechanism`) is PURE display
 * enrichment over an already-RLS-admitted set — it adds no visibility; this fixture only
 * sets up the four admitting mechanisms so the badge/facet e2e can assert each one + the
 * precedence winner over real data.
 */
export const SHARE_MECHANISM_SCENARIO: SeedScenario = {
  id: 'share-mechanism',
  title: 'Shared-with-me mechanism distinction',
  summary:
    'One non-owner `viewer` sees four nodes owned by another member, one per "Shared with me" mechanism — per-user grant → personal, cohort grant → cohort, space-floor publish → broadcast, plus a both-granted node that must win as personal (precedence personal > cohort > broadcast, ADR-0021 Part C).',
  presets: ['shared'],
  actors: [
    // The single non-owner grantee. A plain `member` (base read holds via
    // `space.knowledge.read`) so owner ≠ viewer → all four nodes land in its `'shared'`
    // lens; its `member` role is exactly the case the new `knowledge_user_scope_ids()`
    // RPC exists for (a `member` lacks the legacy `space.content.read` the
    // `scope_memberships` SELECT RLS gates on, so a cohort node must still annotate
    // `cohort`, never fall through to `broadcast`).
    { ref: 'viewer', role: 'member', displayName: 'Vera Viewer' },
    // Owns all four nodes and authors each node's own grant (owner-sovereign). `admin`
    // so it holds `space.knowledge.access` for the per-user grants on its own content.
    { ref: 'owner', role: 'admin', displayName: 'Oscar Owner' },
  ],
  // The cohort the broadcast/cohort distinction turns on: `viewer` is a member, so a node
  // fenced to it annotates `cohort` for the viewer. The membership write is authored by
  // the built-in `admin` access-manager (the materializer's scope loop), exactly as a
  // space access-manager would enrol a member into a cohort.
  scopes: [
    { ref: 'mech-cohort', name: 'Mechanism Cohort', members: ['viewer'] },
  ],
  tree: [
    {
      ref: 'share-mechanism/folder',
      kind: 'folder',
      owner: 'owner',
      title: 'Shared-with-me mechanisms',
      description:
        'Four docs a teammate shares four ways — one per access mechanism the viewer sees.',
      // Published so the viewer can SEE the folder itself as the shared-lens container;
      // the per-node mechanism distinction is on the children.
      visibility: 'space',
      children: [
        {
          ref: 'share-mechanism/personal',
          kind: 'text',
          owner: 'owner',
          title: 'Shared with me directly (personal)',
          // floor=private (default) + ONE per-user grant to `viewer` — the SOLE
          // widening disjunct → annotates `personal` in the viewer's shared lens.
          userGrants: ['viewer'],
          body: prose(
            'A teammate shared this note with you BY NAME — a per-user grant, the most deliberate way to share.',
            'In your "Shared with me" lens it carries the "personal" mechanism: it is visible to you because someone granted it to you directly, not because of a cohort or a floor.'
          ),
        },
        {
          ref: 'share-mechanism/cohort',
          kind: 'text',
          owner: 'owner',
          title: 'Shared with my cohort (cohort)',
          // floor=private (default) + a cohort grant to `mech-cohort` (viewer is a
          // member) — the SOLE widening disjunct → annotates `cohort`.
          scopes: ['mech-cohort'],
          body: prose(
            'A teammate fenced this note to a cohort you belong to — everyone in that group can see it, you among them.',
            'In your "Shared with me" lens it carries the "cohort" mechanism: you see it because of your membership in the cohort, not a personal grant or a space-wide publish.'
          ),
        },
        {
          ref: 'share-mechanism/broadcast',
          kind: 'text',
          owner: 'owner',
          title: 'Published to the whole space (broadcast)',
          // floor='space' — visible to every space member via the broadcast floor.
          // No per-user grant, no cohort for the viewer → annotates `broadcast`
          // (the residual: floor/supervisory).
          visibility: 'space',
          body: prose(
            'A teammate published this note to the whole space — every member can see it, including you.',
            'In your "Shared with me" lens it carries the "broadcast" mechanism: you see it via the space floor, the least targeted way to share (the residual once a personal grant and a cohort are ruled out).'
          ),
        },
        {
          ref: 'share-mechanism/both',
          kind: 'text',
          owner: 'owner',
          title:
            'Both personally granted AND cohort-fenced (precedence → personal)',
          // floor=private (default) + BOTH a per-user grant to `viewer` AND a cohort
          // grant to `mech-cohort` (viewer is a member). TWO admitting mechanisms — the
          // annotation must report the MOST DELIBERATE one: `personal` wins over `cohort`
          // (precedence personal > cohort > broadcast). The precedence assertion.
          userGrants: ['viewer'],
          scopes: ['mech-cohort'],
          body: prose(
            'A teammate shared this note with you BOTH directly (by name) AND through a cohort you belong to — two paths to the same content.',
            'Your "Shared with me" lens reports only the WINNING mechanism, the most deliberate one: "personal" takes precedence over "cohort", which takes precedence over "broadcast". So this note badges as personal even though the cohort would also admit it.'
          ),
        },
      ],
    },
  ],
};
