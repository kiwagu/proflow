import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Hierarchy-access scenario — the FOURTH access dimension, distinct from
 * cohort/floor sharing. A reporting line makes `demo-admin` the manager of
 * `demo-viewer`; the manager then sees the report's PRIVATE content automatically
 * (RLS hierarchy branch — oversight without the report having to share). The doc
 * stays `private` (no `visibility`), yet appears in the manager's Drive.
 */
export const HIERARCHY_SCENARIO: SeedScenario = {
  id: 'hierarchy',
  title: 'Manager visibility',
  summary:
    'A reporting line (admin manages viewer) lets the manager see a report’s PRIVATE content — access via hierarchy, not sharing.',
  presets: ['hierarchy'],
  reportingLines: [{ manager: 'admin', subordinate: 'viewer' }],
  tree: [
    {
      ref: 'hierarchy/folder',
      kind: 'folder',
      owner: 'viewer',
      title: 'Private Workspace',
      description:
        'Private to the report — the manager sees it via the reporting line, not a share.',
      children: [
        {
          ref: 'hierarchy/plan',
          kind: 'text',
          owner: 'viewer',
          title: 'My Draft Plan (private)',
          body: prose(
            'A private working doc — my rough plan for the next sprint, not yet ready to share with the team.',
            'Goal: finish the read-view polish, then finally start on the notifications work I keep putting off.',
            'My manager can see this through our reporting line even though it is private — that is the point of hierarchy access: oversight without me sharing it manually.',
            'Once it is in shape I will publish it to the whole team.'
          ),
        },
      ],
    },
  ],
};
