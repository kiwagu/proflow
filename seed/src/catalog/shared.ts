import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Shared-with-me scenario — the cross-sharing story. "Shared with me" is the set
 * of nodes you can SEE but do NOT own, so to fill it for BOTH demo users each one
 * must own content the OTHER can see. `demo-admin` (owner `admin`) and `demo-viewer`
 * (owner `viewer`, a `member`) each publish a couple of docs to the space floor, so:
 *  - the `viewer`-owned docs land in `demo-admin`'s "Shared with me", and
 *  - the `admin`-owned docs land in `demo-viewer`'s "Shared with me".
 * (With two members, a space-floor publish is effectively "shared with the other".)
 */
export const SHARED_SCENARIO: SeedScenario = {
  id: 'shared',
  title: 'Shared with me',
  summary:
    'Each demo user publishes a couple of docs to the space, so "Shared with me" is populated both ways (admin↔viewer).',
  presets: ['shared'],
  tree: [
    {
      ref: 'shared/admin/roadmap',
      kind: 'text',
      owner: 'admin',
      visibility: 'space',
      title: 'Q3 Product Roadmap',
      description: 'Shared by the admin with the team.',
      body: prose(
        'Here is where we are taking the product this quarter. Leave feedback in the margins — this is a living plan, not a contract.',
        'Our top priority is reliability: halve error rates and make the onboarding flow rock-solid before we add new surface area.',
        'Second, we invest in collaboration — sharing, comments, and a cleaner activity feed — so teams can work together in one place.',
        'Dates here are targets, not promises. Expect this to shift as we learn from the work.'
      ),
    },
    {
      ref: 'shared/admin/brand',
      kind: 'text',
      owner: 'admin',
      visibility: 'space',
      title: 'Brand Guidelines',
      description: 'Shared by the admin with the team.',
      body: prose(
        'These guidelines keep our product and communications feeling like one coherent brand.',
        'Voice: clear, warm, and direct. We explain rather than impress, and we never talk down to the reader.',
        'Color and type live in the design system — reach for the tokens rather than hard-coding values.',
        'When in doubt, favor clarity over cleverness: in copy, in layout, and in motion.'
      ),
    },
    {
      ref: 'shared/viewer/notes',
      kind: 'text',
      owner: 'viewer',
      visibility: 'space',
      title: 'Weekly Team Notes',
      description: 'Shared by a teammate with everyone.',
      // demo-admin stars this teammate-shared doc — a star ON shared content.
      starredBy: ['admin'],
      body: prose(
        'Notes from this week’s team sync, shared so everyone stays in the loop.',
        'We shipped the new sharing flow to staging and started dogfooding it internally — early feedback is positive.',
        'Open question: how do we surface notifications without overwhelming people? Proposals welcome.',
        'Next week we focus on read-view polish and closing out the remaining accessibility issues.'
      ),
    },
    {
      ref: 'shared/viewer/research',
      kind: 'text',
      owner: 'viewer',
      visibility: 'space',
      title: 'Customer Research Summary',
      description: 'Shared by a teammate with everyone.',
      // demo-admin recently opened this teammate doc → shows in admin's Recent.
      openedBy: ['admin'],
      body: prose(
        'A short summary of the latest round of customer interviews, shared for visibility.',
        'The strongest theme: people want their content private by default and shared only on purpose — which matches our access model.',
        'Several users asked for an easy way to see what others have shared with them, separate from their own files.',
        'We will turn these findings into concrete tickets and prioritize them in the next planning session.'
      ),
    },
  ],
};
