'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { FacetChip } from '@workspace/ui/components/facet-chip';
import { RailSectionHeading } from '@workspace/ui/components/rail-section-heading';

import type { ResourceTag } from '@/app/graph/graph-page.data';
import { kindLabel } from './lens-presentation';

/**
 * LensFacets — the type + tag facet panel (slice-09 §3.5). Both facets NARROW
 * the already-resolved, already-RLS-narrowed set CLIENT-SIDE — never a re-resolve
 * (RLS was the authority at resolve time; a client filter can only hide rows it
 * already holds, no security difference). Type facet lists only the kinds present
 * (`text`/`link`); tag facet lists the union of the set's tags. OR within tags.
 *
 * Purely presentational: selection state + handlers are owned by the container.
 */

export type HealthFacet = 'orphan' | 'stale';

export type LensFacetsProps = {
  t: GraphTranslator;
  /** kinds present in the resolved set (e.g. ['text','link']). */
  kinds: string[];
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

/** Health facet label via LITERAL keys (no dynamic-key indirection in views). */
function healthLabel(t: GraphTranslator, facet: HealthFacet): string {
  return facet === 'orphan'
    ? t('graph.lens.healthOrphan')
    : t('graph.lens.healthStale');
}

const HEALTH_FACETS: HealthFacet[] = ['orphan', 'stale'];

export function LensFacets({
  t,
  kinds,
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
      {kinds.length > 0 ? (
        <section className="flex flex-col gap-2">
          <RailSectionHeading>{t('graph.lens.filterType')}</RailSectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((kind) => (
              <FacetChip
                key={kind}
                label={kindLabel(t, kind)}
                active={activeKinds.has(kind)}
                onToggle={() => onToggleKind(kind)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {tags.length > 0 ? (
        <section className="flex flex-col gap-2">
          <RailSectionHeading>{t('graph.lens.filterTag')}</RailSectionHeading>
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

      <section className="flex flex-col gap-2">
        <RailSectionHeading>{t('graph.lens.filterHealth')}</RailSectionHeading>
        <div className="flex flex-wrap gap-1.5">
          {HEALTH_FACETS.map((facet) => (
            <FacetChip
              key={facet}
              label={healthLabel(t, facet)}
              active={activeHealth.has(facet)}
              onToggle={() => onToggleHealth(facet)}
            />
          ))}
        </div>
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
