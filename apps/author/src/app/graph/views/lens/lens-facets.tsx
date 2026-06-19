'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { FacetCheckbox } from '@workspace/ui/components/facet-checkbox';
import { FacetChip } from '@workspace/ui/components/facet-chip';
import { RailSectionHeading } from '@workspace/ui/components/rail-section-heading';
import { ClockAlert, Unlink } from 'lucide-react';

import type { ResourceTag } from '@/app/graph/graph-page.data';
import { iconForKind } from './lens-presentation';

/**
 * LensFacets — the type / tag / health facet panel (prototype LensView rail, §3.5).
 * All three facets NARROW the already-resolved, already-RLS-narrowed set
 * CLIENT-SIDE — never a re-resolve (RLS was the authority at resolve time; a client
 * filter can only hide rows it already holds).
 *
 * Type + health are checkbox ROWS with a leading icon (the prototype shape); tags
 * are pill chips. The TYPE list is FIXED (Documents / Files / Video / Links) — every
 * content kind the graph can hold is always offered as a filter, even when the
 * current set has none of that kind (prototype-parity), so toggling it simply yields
 * no matches. Purely presentational: selection state + handlers come from the owner.
 */

export type HealthFacet = 'orphan' | 'stale';

/** Fixed content kinds offered as type facets (prototype TYPE_FACETS). */
const TYPE_KINDS = ['text', 'file', 'video', 'link'] as const;
const HEALTH_FACETS: HealthFacet[] = ['orphan', 'stale'];

export type LensFacetsProps = {
  t: GraphTranslator;
  activeKinds: ReadonlySet<string>;
  onToggleKind: (kind: string) => void;
  /** union of tags across the set (id + title). */
  tags: ResourceTag[];
  activeTagIds: ReadonlySet<string>;
  onToggleTag: (tagId: string) => void;
  /** DERIVED health facets (orphan/stale) — slice-11 Ф2 §3. */
  activeHealth: ReadonlySet<HealthFacet>;
  onToggleHealth: (facet: HealthFacet) => void;
  onClear: () => void;
  hasActiveFilter: boolean;
};

/** Type-facet label via LITERAL keys (no dynamic-key indirection in views). */
function typeLabel(t: GraphTranslator, kind: string): string {
  switch (kind) {
    case 'text':
      return t('graph.lens.typeText');
    case 'file':
      return t('graph.lens.typeFile');
    case 'video':
      return t('graph.lens.typeVideo');
    case 'link':
      return t('graph.lens.typeLink');
    default:
      return kind;
  }
}

/** Health-facet label + icon via LITERAL keys. */
function healthLabel(t: GraphTranslator, facet: HealthFacet): string {
  return facet === 'orphan'
    ? t('graph.lens.healthOrphan')
    : t('graph.lens.healthStale');
}

const HEADING_CLASS = 'tracking-wide uppercase';

export function LensFacets({
  t,
  activeKinds,
  onToggleKind,
  tags,
  activeTagIds,
  onToggleTag,
  activeHealth,
  onToggleHealth,
  onClear,
  hasActiveFilter,
}: LensFacetsProps) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <RailSectionHeading className={HEADING_CLASS}>
          {t('graph.lens.filterType')}
        </RailSectionHeading>
        {TYPE_KINDS.map((kind) => {
          const Icon = iconForKind(kind);
          return (
            <FacetCheckbox
              key={kind}
              checked={activeKinds.has(kind)}
              onCheckedChange={() => onToggleKind(kind)}
              icon={<Icon className="size-[15px]" aria-hidden />}
            >
              {typeLabel(t, kind)}
            </FacetCheckbox>
          );
        })}
      </section>

      {tags.length > 0 ? (
        <section className="flex flex-col gap-2">
          <RailSectionHeading className={HEADING_CLASS}>
            {t('graph.lens.filterTag')}
          </RailSectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <FacetChip
                key={tag.id}
                label={tag.title}
                active={activeTagIds.has(tag.id)}
                onToggle={() => onToggleTag(tag.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <RailSectionHeading className={HEADING_CLASS}>
          {t('graph.lens.filterHealth')}
        </RailSectionHeading>
        {HEALTH_FACETS.map((facet) => (
          <FacetCheckbox
            key={facet}
            checked={activeHealth.has(facet)}
            onCheckedChange={() => onToggleHealth(facet)}
            icon={
              facet === 'orphan' ? (
                <Unlink className="size-[15px]" aria-hidden />
              ) : (
                <ClockAlert className="size-[15px]" aria-hidden />
              )
            }
          >
            {healthLabel(t, facet)}
          </FacetCheckbox>
        ))}
      </section>

      {hasActiveFilter ? (
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-4 hover:underline"
        >
          {t('graph.lens.clearFilter')}
        </button>
      ) : null}
    </div>
  );
}
