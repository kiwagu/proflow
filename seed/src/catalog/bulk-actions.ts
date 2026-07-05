import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Bulk-actions fixture (release-hardening B2) — an e2e-only shape for the Drive
 * multi-select → floating bulk action bar → Empty Trash flow. Like `drive-cascade`
 * / `drive-copy-chain` / `drive-size-filter` it is DELIBERATELY absent from
 * `ALL_SCENARIOS` (a contrived set of near-identical selectable siblings + a known
 * trashed pair is not demo content — bulk-select works over ANY canvas, so the demo
 * needs no bespoke tree); the spec materializes it directly via `materializeFixture`.
 *
 * It gives the spec a DETERMINISTIC, ref-addressed set:
 *  - `bulk/root` — a browse folder of FOUR content docs (`bulk/alpha`…`bulk/delta`)
 *    whose titles sort in declaration order, so a SHIFT-click range over the ordered-
 *    visible list is predictable and there are ≥2 selectable siblings to bulk-Trash /
 *    bulk-Star;
 *  - `bulk/trashed-one` + `bulk/trashed-two` — two loose docs soft-deleted at seed time
 *    (the scenario's `trash` list), so the Trash lens opens with a known trashed set for
 *    bulk Restore.
 *
 * Every row is created through the same `/author/graph/*` create-vocabulary the demo
 * seed uses (folders/docs via the live routes, the two trashed via the resource DELETE
 * = soft-trash) — never a migration seed.
 */
export const BULK_ACTIONS_SCENARIO: SeedScenario = {
  id: 'bulk-actions',
  title: 'Bulk actions playground',
  summary:
    'A deterministic multi-select set — a folder of four selectable content siblings (for bulk Trash / Star / Move + SHIFT-range) beside two pre-trashed docs (for bulk Restore + Empty Trash).',
  // e2e-only: excluded from ALL_SCENARIOS, but a preset tag is required + it rides the
  // Drive capability group conceptually.
  presets: ['drive'],
  tree: [
    {
      ref: 'bulk/root',
      kind: 'folder',
      title: 'Bulk Playground',
      description:
        'Four selectable siblings for the multi-select bulk action bar.',
      children: [
        {
          ref: 'bulk/alpha',
          kind: 'text',
          title: 'Bulk Alpha',
          body: prose(
            'First selectable sibling — trashed by the bulk Trash proof.'
          ),
        },
        {
          ref: 'bulk/bravo',
          kind: 'text',
          title: 'Bulk Bravo',
          body: prose(
            'Second selectable sibling — trashed by the bulk Trash proof.'
          ),
        },
        {
          ref: 'bulk/charlie',
          kind: 'text',
          title: 'Bulk Charlie',
          body: prose(
            'Third selectable sibling — starred by the bulk Star proof.'
          ),
        },
        {
          ref: 'bulk/delta',
          kind: 'text',
          title: 'Bulk Delta',
          body: prose(
            'Fourth selectable sibling — starred by the bulk Star proof.'
          ),
        },
      ],
    },
    {
      ref: 'bulk/trashed-one',
      kind: 'text',
      title: 'Trashed One',
      body: prose(
        'A loose doc soft-deleted at seed time — restored by the bulk Restore proof.'
      ),
    },
    {
      ref: 'bulk/trashed-two',
      kind: 'text',
      title: 'Trashed Two',
      body: prose(
        'A second loose doc soft-deleted at seed time — restored by the bulk Restore proof.'
      ),
    },
  ],
  // The two loose docs open in the Trash lens (a known trashed set for bulk Restore).
  trash: ['bulk/trashed-one', 'bulk/trashed-two'],
};
