import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Access scenario — the two-user sharing story the platform is built around.
 * `admin` owns three docs and shares them three different ways; a `teammate`
 * (cohort member) and an `outsider` (not) get DIFFERENT visibility. This is the
 * worked example of fail-closed, additive sharing:
 *  - a PRIVATE doc only the owner sees;
 *  - a doc shared to the 'Project X' cohort — `teammate` sees it, `outsider` does not;
 *  - a SPACE-published doc everyone in the space sees.
 *
 * The seed creates the data + grants; resolving it AS each actor (who sees what)
 * is what the access e2e proves. Here it stands as the demo + the learning material.
 */
export const ACCESS_SCENARIO: SeedScenario = {
  id: 'access',
  title: 'Two-user sharing',
  summary:
    'One owner, three docs shared three ways (private / cohort-shared / space-published) so a teammate and an outsider see different things.',
  presets: ['access'],
  actors: [
    { ref: 'teammate', role: 'admin' },
    { ref: 'outsider', role: 'admin' },
  ],
  scopes: [{ ref: 'project-x', name: 'Project X', members: ['teammate'] }],
  tree: [
    {
      ref: 'access/folder',
      kind: 'folder',
      title: 'Sharing Examples',
      description: 'Three docs shared three different ways.',
      visibility: 'space',
      children: [
        {
          ref: 'access/private',
          kind: 'text',
          title: 'Private Note (owner only)',
          body: prose(
            'This note is private. Only its owner can see it — sharing is a deliberate act, never the default.'
          ),
        },
        {
          ref: 'access/cohort',
          kind: 'text',
          title: 'Project X Brief (cohort-shared)',
          // Private floor + an additive grant to the Project X cohort.
          scopes: ['project-x'],
          body: prose(
            'Shared with the Project X cohort. A teammate in that cohort sees it; an outsider does not.',
            'Access is additive: the owner widened the audience by one OR-ed cohort grant.'
          ),
        },
        {
          ref: 'access/published',
          kind: 'text',
          title: 'Team Announcement (space-published)',
          visibility: 'space',
          body: prose(
            'Published to the whole space floor — every space member sees it, cohort or not.'
          ),
        },
      ],
    },
  ],
};
