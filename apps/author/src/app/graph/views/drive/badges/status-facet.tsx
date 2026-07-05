'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { ResourceStatus } from '@workspace/knowledge-contracts';
import { ToggleChip } from '@workspace/ui/components/toggle-chip';
import { CircleDot } from 'lucide-react';
import * as React from 'react';

/**
 * StatusFacetChips — the workflow-status facet chip row (draft/active/archived). The
 * lifecycle sibling of the "Only files" toggle and the tag facet: a client display
 * filter that narrows the visible CONTENT to a single lifecycle state, reusing the
 * SAME leaf-prune the other content filters use (so a browse tree prunes to branches
 * with a matching leaf). Single-select, radio-style: "All" clears; a state chip
 * selects it. A pure display filter over the resolved canvas (`LensNode.status`),
 * never a fence — status is already materialized under the caller's RLS.
 *
 * Each state carries a LITERAL i18n key (statically extractable). Mirrors
 * {@link ShareFacetChips} (lens-feature-component-reuse, not a new primitive).
 */
const STATUS_ORDER: readonly ResourceStatus[] = ['draft', 'active', 'archived'];

const STATUS_LABEL: Record<ResourceStatus, (t: GraphTranslator) => string> = {
  draft: (t) => t('graph.status.draft'),
  active: (t) => t('graph.status.active'),
  archived: (t) => t('graph.status.archived'),
};

export function StatusFacetChips({
  t,
  active,
  onChange,
}: {
  t: GraphTranslator;
  /** The selected status, or `null` for "All". */
  active: ResourceStatus | null;
  onChange: (next: ResourceStatus | null) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground mr-0.5 inline-flex items-center gap-1 text-xs">
        <CircleDot className="size-3" aria-hidden />
        {t('graph.lens.filterStatus')}
      </span>
      <ToggleChip
        label={t('graph.drive.facetAll')}
        pressed={active == null}
        onPressedChange={() => onChange(null)}
      />
      {STATUS_ORDER.map((status) => (
        <ToggleChip
          key={status}
          label={STATUS_LABEL[status](t)}
          pressed={active === status}
          onPressedChange={() => onChange(status)}
        />
      ))}
    </div>
  );
}
