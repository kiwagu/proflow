import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import {
  FolderInput,
  Globe,
  Lock,
  Share2,
  Users,
  UsersRound,
} from 'lucide-react';
import * as React from 'react';

import {
  broadcastOut,
  sharedOut,
  type Containment,
} from '@/app/graph/containment';
import { ShareDialog } from '@/app/graph/views/resource-panel/share-dialog';
import type {
  ResourceFloor,
  SharedByMeEntry,
} from '@/app/graph/graph-data.types';

import { PanelSectionLabel } from './panel-section-label';
import type { SelectedNode } from './resource-panel';

/**
 * AccessMetaLine — the muted, small icon-led detail line in the Access summary (the
 * grantee count header and the "Inherited from {folder}" line both share the exact
 * `text-muted-foreground flex items-center gap-1.5 text-xs` shell). Lifting the repeated
 * cluster into one local component keeps the look IDENTICAL (ui-primitive-hygiene). Icon
 * + text are the caller's.
 */
function AccessMetaLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
      {children}
    </div>
  );
}

/** Floor icon + short label for the read-only Access summary. */
const FLOOR_META: Record<
  ResourceFloor,
  { icon: typeof Lock; label: (t: GraphTranslator) => string }
> = {
  private: { icon: Lock, label: (t) => t('graph.panel.accessFloorPrivate') },
  space: { icon: Users, label: (t) => t('graph.panel.accessFloorSpace') },
  organization: {
    icon: Globe,
    label: (t) => t('graph.panel.accessFloorOrganization'),
  },
};

// Cap before the grantee / inherited lists scroll within a bounded max-height (a count
// header + a ScrollArea, the read-side analogue of the paged picker).
const ACCESS_LIST_MAX_H = 'max-h-40';

/**
 * AccessSection — the READ-ONLY "Access" summary in the ResourcePanel (Tier 2).
 * It MIRRORS the access predicate; it never mutates. It shows:
 *   - the broadcast FLOOR (Private / Space / Organization), from the node's `visibility`;
 *   - the explicit GRANTEES by name (from `kbData.sharedByMe`, co-member-labelled);
 *   - an "Inherited from {folder}" line when the node is visible via a granted ANCESTOR,
 *     computed by the SAME client ancestor walk (`sharedOut`) that drives the card badge;
 *   - a "Manage access" affordance opening the EXISTING ShareDialog (the ONLY editor —
 *     unchanged for MANAGEMENT; this is a distinct read-only tier, §7c).
 *
 * The grantee list (and, in principle, a multi-ancestor inherited list) is a count header
 * + a bounded `ScrollArea` so a large audience never grows the panel unbounded. DISPLAY
 * only — owner-sovereignty + RLS untouched; data is already client-side (no new load).
 */
export function AccessSection({
  t,
  spaceId,
  node,
  containment,
  currentUserId,
  ownerUserId,
  canShare,
  visibility,
  grantees,
  sharedByMeIds,
  visibilityById,
  onMutated,
}: {
  t: GraphTranslator;
  spaceId: string;
  node: SelectedNode;
  containment: Containment;
  currentUserId: string | null;
  ownerUserId: string | null;
  canShare: boolean;
  visibility: ResourceFloor | null;
  grantees: SharedByMeEntry['grantees'];
  sharedByMeIds: Set<string>;
  visibilityById: Map<string, ResourceFloor>;
  onMutated: () => void;
}) {
  const [shareOpen, setShareOpen] = React.useState(false);

  // The access-mirror walk — the SAME `sharedOut` the card badge uses, so
  // the panel's "Inherited from" line can never diverge from the badge. `inheritedFrom` is
  // the nearest granted ancestor folder (null when the node is granted directly or not at
  // all). A node carrying its OWN direct grant lists its grantees; a purely-inherited node
  // shows the inherited line instead.
  const shared = sharedOut(containment, node.id, (id) => sharedByMeIds.has(id));

  // The BROADCAST half of the mirror (the globe state) — the SAME
  // `broadcastOut` the card globe badge runs, so the panel's broadcast line can never
  // diverge from the badge. `broadcastVia` is the nearest broadcast-floor ANCESTOR folder
  // when the node is broadcast purely by floor inheritance (null when its OWN floor
  // broadcasts, or it is not broadcast at all) — the parallel of `sharedOut`'s
  // `inheritedFrom`.
  const broadcast = broadcastOut(containment, node.id, (id) =>
    visibilityById.get(id)
  );

  const floor = visibility ?? 'private';
  const FloorIcon = FLOOR_META[floor].icon;
  const floorLabel = FLOOR_META[floor].label(t);

  // The merged audience carries BOTH per-user grants and cohort grants,
  // each tagged with `kind`. Split them so a cohort is never miscounted/mislabelled as a
  // "person" — people get a name+email row, cohorts a group row counted as cohorts.
  const people = grantees.filter((g) => g.kind === 'user');
  const cohorts = grantees.filter((g) => g.kind === 'cohort');

  return (
    <section className="flex flex-col gap-2.5">
      <PanelSectionLabel>
        <Share2 className="size-3" aria-hidden />
        {t('graph.panel.accessSection')}
      </PanelSectionLabel>

      {/* Floor — the single broadcast dial, read-only (the node's OWN visibility). */}
      <div className="flex items-center gap-2 text-sm">
        <FloorIcon
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <span className="font-medium">{floorLabel}</span>
      </div>

      {/* Inherited broadcast — the node's own floor is private but a broadcast-floor
          ANCESTOR folder auto-broadcasts it to the whole scope (floor inheritance). The
          parallel of the per-user "Inherited from {folder}" line; the read-side mirror of
          the card globe badge. Only when broadcast is PURELY inherited (`broadcastVia`
          set — an own-floor broadcast is already named by the floor line above). */}
      {broadcast.broadcastVia != null ? (
        <AccessMetaLine>
          <Globe className="size-3.5 shrink-0" aria-hidden />
          {t('graph.panel.accessBroadcastViaFolder', {
            scope:
              broadcast.scope === 'organization'
                ? t('graph.panel.accessFloorOrganization')
                : t('graph.panel.accessFloorSpace'),
            folder: broadcast.broadcastVia.title,
          })}
        </AccessMetaLine>
      ) : null}

      {/* Per-user grantees — count header + bounded scroll list of names (people only). */}
      {people.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <AccessMetaLine>
            <Users className="size-3.5 shrink-0" aria-hidden />
            {people.length === 1
              ? t('graph.panel.accessSharedWithOne')
              : t('graph.panel.accessSharedWithCount', {
                  count: people.length,
                })}
          </AccessMetaLine>
          <ScrollArea className={ACCESS_LIST_MAX_H}>
            <ul className="flex flex-col gap-1 pr-2.5">
              {people.map((g) => (
                <li
                  key={g.userId}
                  className="flex items-center gap-2 rounded-md px-1 py-1"
                >
                  <EntityAvatar name={g.displayName} className="size-6" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{g.displayName}</span>
                    {g.email ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {g.email}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      ) : null}

      {/* Cohort (group) grants — counted and labelled as COHORTS, never "people"; a group
          glyph (not a person avatar) so the audience meaning is not distorted. */}
      {cohorts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <AccessMetaLine>
            <UsersRound className="size-3.5 shrink-0" aria-hidden />
            {cohorts.length === 1
              ? t('graph.panel.accessSharedWithCohortOne')
              : t('graph.panel.accessSharedWithCohortCount', {
                  count: cohorts.length,
                })}
          </AccessMetaLine>
          <ScrollArea className={ACCESS_LIST_MAX_H}>
            <ul className="flex flex-col gap-1 pr-2.5">
              {cohorts.map((c) => (
                <li
                  key={c.userId}
                  className="flex items-center gap-2 rounded-md px-1 py-1"
                >
                  <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full">
                    <UsersRound className="size-3.5" aria-hidden />
                  </span>
                  <span className="truncate text-sm">{c.displayName}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      ) : null}

      {/* Inherited access — the named expression of the ancestor chain the badge mirrors
          silently (only when the node is NOT directly granted but reachable via a granted
          ancestor — additive to a direct grant or floor). */}
      {shared.inheritedFrom != null ? (
        <AccessMetaLine>
          <FolderInput className="size-3.5 shrink-0" aria-hidden />
          {t('graph.panel.accessInheritedFrom', {
            folder: shared.inheritedFrom.title,
          })}
        </AccessMetaLine>
      ) : null}

      {/* Nothing shared, not broadcast, and private → say so plainly (the access summary
          is never blank). An inherited broadcast or any grant suppresses the line. */}
      {floor === 'private' &&
      grantees.length === 0 &&
      shared.inheritedFrom == null &&
      broadcast.broadcastVia == null ? (
        <p className="text-muted-foreground text-xs">
          {t('graph.panel.accessPrivateOnly')}
        </p>
      ) : null}

      {/* Manage access — opens the EXISTING ShareDialog (the editor, unchanged). The panel
          never mutates; this is the one bridge from read-status to the management surface. */}
      {canShare ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShareOpen(true)}
            className="mt-0.5"
          >
            <Share2 className="size-4" aria-hidden />
            {t('graph.panel.manageAccess')}
          </Button>
        </div>
      ) : null}

      <ShareDialog
        t={t}
        spaceId={spaceId}
        open={shareOpen}
        onOpenChange={setShareOpen}
        node={{ id: node.id, title: node.title }}
        currentUserId={currentUserId}
        ownerUserId={ownerUserId}
        onMutated={onMutated}
      />
    </section>
  );
}
