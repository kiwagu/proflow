import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { ResourceStatus } from '@workspace/knowledge-contracts';
import {
  SegmentedControl,
  SegmentedControlButton,
} from '@workspace/ui/components/segmented-control';
import * as React from 'react';

import { PanelSectionLabel } from './panel-section-label';
import { sendJson } from './panel-fetch';

/**
 * StatusSection — the node's workflow-status transition control (`draft` → `active`
 * → `archived`). Replaces the old read-only status badge: a lifecycle state the user
 * could see but not change was a dead affordance (honesty nit A2). Each segment is a
 * direct transition — click a non-active state → PATCH `/author/graph/status`, then
 * the workbench re-resolves (`onMutated`). Status (workflow) is orthogonal to access
 * (`visibility`) and trash (`deleted_at`); this writes only `status`.
 *
 * Purely presentational: it POSTs to the landed RLS route; RLS is the
 * sole authority (`space.knowledge.update` on the row). A reader's write fails
 * cleanly with no change — the segment simply does not move.
 */

// The three lifecycle states in order, each with its LITERAL i18n key (keeps the
// keys statically extractable even though the control is data-driven — same
// discipline as the Drive nav).
const STATES: ReadonlyArray<{
  value: ResourceStatus;
  label: (t: GraphTranslator) => string;
}> = [
  { value: 'draft', label: (t) => t('graph.status.draft') },
  { value: 'active', label: (t) => t('graph.status.active') },
  { value: 'archived', label: (t) => t('graph.status.archived') },
];

export function StatusSection({
  t,
  spaceId,
  nodeId,
  status,
  onMutated,
}: {
  t: GraphTranslator;
  spaceId: string;
  nodeId: string;
  /** The node's current `knowledge_resources.status`. Unknown statuses (should not
   * happen — the column is CHECK-constrained) highlight no segment. */
  status: string;
  onMutated: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  async function onSelect(next: ResourceStatus) {
    if (next === status || busy) {
      return;
    }
    setBusy(true);
    const ok = await sendJson(
      '/author/graph/status',
      { spaceId, resourceId: nodeId, status: next },
      'PATCH'
    );
    setBusy(false);
    if (ok) {
      onMutated();
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <PanelSectionLabel>{t('graph.panel.status')}</PanelSectionLabel>
      <SegmentedControl className="w-full">
        {STATES.map((state) => (
          <SegmentedControlButton
            key={state.value}
            active={state.value === status}
            disabled={busy}
            onClick={() => onSelect(state.value)}
            className="flex-1 justify-center"
          >
            {state.label(t)}
          </SegmentedControlButton>
        ))}
      </SegmentedControl>
    </section>
  );
}
