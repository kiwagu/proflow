import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Status-lifecycle scenario — the worked example for the resource WORKFLOW lifecycle
 * (`draft` → `active` → `archived`, B1). Making `knowledge_resources.status` a coarse
 * three-state column (migration 20260615190243) let the workbench add two surfaces:
 *
 *  1. the ResourcePanel transition control (`StatusSection`) — a shadcn SegmentedControl
 *     of the three states, the active one = the node's current `status`; clicking a
 *     non-active segment PATCHes `/author/graph/status` (RLS-fenced to
 *     `space.knowledge.update`) and re-resolves. Rendered for CONTENT kinds only (a
 *     folder/tag has no lifecycle);
 *  2. the Drive status facet (`StatusFacetChips`, `graph.lens.filterStatus`) — a single-
 *     select chip row (All / Draft / Active / Archived) that prunes the canvas to CONTENT
 *     in one lifecycle state, the exact sibling of the "Only files" toggle. Shown only
 *     when the resolved canvas carries ≥2 DISTINCT content statuses.
 *
 * The tree is one folder of three text docs, one per lifecycle state, so the facet always
 * has ≥2 statuses to render over and the transition/filter e2e has known nodes at known
 * states. A text doc is born `status='active'` (the text-resource fan-out default), so each
 * declared state is written through the product's OWN new route at seed time (the
 * materializer's `lifecycleStatus` → `seedClientFor(owner).setStatus`, RLS-fenced as the
 * owner) — never a direct column write, exactly as the panel's transition control does. The
 * demo Drive and the e2e (`knowledge-status-lifecycle.e2e.spec.ts`) therefore name the SAME
 * nodes at the SAME states through the one create-vocabulary.
 *
 * Rides the `drive` (so the demo Drive shows a live status facet) + `status` presets. Owner
 * is the primary `admin`; the docs are private-by-default (the owner sees + edits them, and
 * the RLS-negative — a member without `space.knowledge.update` — cannot change their state).
 */

export const STATUS_LIFECYCLE_SCENARIO: SeedScenario = {
  id: 'status-lifecycle',
  title: 'Resource status lifecycle',
  summary:
    'A folder of three content docs, one per workflow-lifecycle state (draft/active/archived) — the worked example for the ResourcePanel status transition control and the Drive status facet (B1). Each declared state is written through the product’s own `PATCH /author/graph/status` route at seed time, so the demo and the e2e name the same nodes at the same states.',
  presets: ['drive', 'status'],
  tree: [
    {
      ref: 'status/root',
      kind: 'folder',
      title: 'Release Notes',
      description:
        'A small set of documents moving through the draft → active → archived lifecycle — the tree the status facet filters and the transition control drives.',
      children: [
        {
          // The DRAFT doc — set to `draft` via the status route (a text doc is born
          // `active`, so this is an explicit demotion). The transition e2e opens THIS
          // node's panel (segment "Draft" pressed) and clicks "Active"; the facet e2e
          // narrows the canvas to it when "Draft" is selected.
          ref: 'status/draft',
          kind: 'text',
          title: 'Draft Release Note',
          description:
            'A note still being written — status "draft" (demoted from the active create default).',
          lifecycleStatus: 'draft',
          body: prose(
            'A release note in progress. Its lifecycle status is "draft" — the state every new node is born in.',
            'The ResourcePanel status control lifts it to "active" when it is ready to publish, then to "archived" once superseded.'
          ),
        },
        {
          // The ACTIVE doc — lifted from draft to `active` via the new route at seed time.
          // It DROPS out of the canvas when the facet is set to "Draft".
          ref: 'status/active',
          kind: 'text',
          title: 'Active Runbook',
          description: 'The current, published runbook — status "active".',
          lifecycleStatus: 'active',
          body: prose(
            'The active runbook — the currently authoritative document teams follow. Its lifecycle status is "active".',
            'It was promoted from "draft" through the workbench status transition control, which writes the change under the owner’s RLS.'
          ),
        },
        {
          // The ARCHIVED doc — lifted to `archived` via the new route at seed time. Gives
          // the canvas a THIRD distinct status so the facet chip row always renders (>1).
          ref: 'status/archived',
          kind: 'text',
          title: 'Archived Postmortem',
          description:
            'A superseded postmortem, kept for the record — status "archived".',
          lifecycleStatus: 'archived',
          body: prose(
            'An archived postmortem — retained for the record but no longer current. Its lifecycle status is "archived".',
            'Archiving is the terminal state of the coarse draft → active → archived lifecycle; the document stays readable but is filtered out of the active working set.'
          ),
        },
      ],
    },
  ],
};
