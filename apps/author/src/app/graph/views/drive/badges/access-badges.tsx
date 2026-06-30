'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';
import { Hint } from '@workspace/ui/components/hint';
import { Globe, Info, Lock, Users } from 'lucide-react';
import * as React from 'react';

import type {
  ResourceFloor,
  SharedByMeEntry,
} from '@/app/graph/graph-data.types';

const GRANTEE_AVATAR_CAP = 3;

/**
 * GranteeSummary — the "who I shared this with" line on a "Shared by me" card
 * (ADR-0021 Part B). A compact avatar cluster + a label: "Shared with {name}" for
 * one grantee, "Shared with {name} +{n}" for a few, or "Shared with {n} people" once
 * the cluster would overflow. Each avatar carries a Hint tooltip with the person's
 * name + email (the same EntityAvatar + Hint pattern the Share dialog uses for the
 * per-person grant rows). Grantees arrive pre-sorted by display name from the data
 * layer (don't re-sort).
 */
export function GranteeSummary({
  t,
  grantees,
}: {
  t: GraphTranslator;
  grantees: SharedByMeEntry['grantees'];
}) {
  if (grantees.length === 0) {
    return null;
  }
  const shown = grantees.slice(0, GRANTEE_AVATAR_CAP);
  const overflow = grantees.length - shown.length;
  // One → name the person; a few → name the first + "+n"; many → just the count.
  const label =
    grantees.length === 1
      ? t('graph.drive.sharedWithOne', { name: grantees[0]!.displayName })
      : grantees.length <= GRANTEE_AVATAR_CAP
        ? t('graph.drive.sharedWithMany', {
            name: grantees[0]!.displayName,
            count: grantees.length - 1,
          })
        : t('graph.drive.sharedWithCount', { count: grantees.length });
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {shown.map((g) => (
          <Hint key={g.userId} label={g.email ?? g.displayName}>
            <span className="inline-flex">
              <EntityAvatar
                name={g.displayName}
                className="ring-card size-5 ring-2"
                fallbackClassName="text-[9px]"
              />
            </span>
          </Hint>
        ))}
        {overflow > 0 ? (
          <span className="bg-muted text-muted-foreground ring-card grid size-5 place-items-center rounded-full text-[9px] font-semibold ring-2">
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="text-muted-foreground truncate text-xs">{label}</span>
    </div>
  );
}

/**
 * AccessBadgeChip — the shared round icon-chip shell for the access-status badges
 * (ADR-0023 §7a): the people-icon `SharedOutBadge` and the globe `BroadcastBadge` are the
 * SAME `size-5` muted round chip wrapped in a `Hint`, differing only in the icon + the
 * tooltip copy. Lifting the shell keeps the two badges pixel-identical and gives the
 * globe-XOR-people taxonomy one visual vocabulary (ui-primitive-hygiene). The Hint label
 * doubles as the `aria-label`, so the badge always names its audience (never a silent mark).
 */
function AccessBadgeChip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <span
        aria-label={label}
        className="text-muted-foreground bg-muted grid size-5 shrink-0 place-items-center rounded-full"
      >
        {children}
      </span>
    </Hint>
  );
}

/**
 * SharedOutBadge — the per-card "this is shared out" people-icon badge (ADR-0023 §7a,
 * Tier 1). It marks a node shown-as-shared per the access-mirror invariant: the node OR
 * a granted ancestor folder is shared (computed by `sharedOut` over the loaded forest).
 * It renders in ALL browse scopes (not only 'shared-by-me') so a node shared via an
 * ancestor badges wherever it appears. The Hint names the audience: the grantee count/
 * names for a direct grant, or "Shared via {folder}" when access is purely inherited —
 * so the badge can never silently imply a node is shared without saying by whom. Pure
 * DISPLAY mirror of the already-resolved `sharedByMe` + forest; never a fence.
 */
export function SharedOutBadge({
  t,
  direct,
  grantees,
  inheritedFromTitle,
}: {
  t: GraphTranslator;
  /** The node carries its OWN direct grant (vs purely inherited from an ancestor). */
  direct: boolean;
  /** Grantees of the DIRECT grant (empty when access is purely inherited). */
  grantees: SharedByMeEntry['grantees'];
  /** Title of the nearest granted ancestor when access is (also) inherited. */
  inheritedFromTitle: string | null;
}) {
  // The tooltip names WHO can read it: the direct grantees (count/names) when granted
  // directly, else the inheriting folder. A direct grant takes precedence in the copy.
  const label =
    direct && grantees.length > 0
      ? grantees.length === 1
        ? t('graph.drive.sharedWithOne', { name: grantees[0]!.displayName })
        : grantees.length <= GRANTEE_AVATAR_CAP
          ? t('graph.drive.sharedWithMany', {
              name: grantees[0]!.displayName,
              count: grantees.length - 1,
            })
          : t('graph.drive.sharedWithCount', { count: grantees.length })
      : inheritedFromTitle != null
        ? t('graph.drive.sharedOutInherited', { folder: inheritedFromTitle })
        : t('graph.drive.sharedOutBadge');
  return (
    <AccessBadgeChip label={label}>
      <Users className="size-3" aria-hidden />
    </AccessBadgeChip>
  );
}

/**
 * BroadcastBadge — the per-card GLOBE badge (ADR-0023 §7a, the broadcast state): the node's
 * EFFECTIVE floor is `space`/`organization`, either its OWN `visibility` or — via floor
 * inheritance — an owner-scoped ancestor folder on a broadcast floor (`broadcastOut`). It
 * OUTRANKS the people badge (a broadcast node is "for everyone in the scope", the widest
 * audience). The Hint NAMES the scope ("Visible to everyone in {Space|Organization}") and,
 * when inherited, the broadcasting folder — so the globe can never silently imply a blast
 * radius. Pure DISPLAY mirror of the RLS-seeded node `visibility` + forest; never a fence.
 */
export function BroadcastBadge({
  t,
  scope,
  broadcastViaTitle,
}: {
  t: GraphTranslator;
  /** The broadcast scope — the node's own floor, else the inheriting folder's. */
  scope: 'space' | 'organization';
  /** Title of the broadcasting ANCESTOR folder when broadcast is inherited, else null. */
  broadcastViaTitle: string | null;
}) {
  const scopeLabel =
    scope === 'organization'
      ? t('graph.drive.broadcastScopeOrganization')
      : t('graph.drive.broadcastScopeSpace');
  // Inherited → name BOTH the scope and the broadcasting folder; own floor → the scope only.
  const label =
    broadcastViaTitle != null
      ? t('graph.drive.broadcastViaFolder', {
          scope: scopeLabel,
          folder: broadcastViaTitle,
        })
      : t('graph.drive.broadcastBadge', { scope: scopeLabel });
  return (
    <AccessBadgeChip label={label}>
      <Globe className="size-3" aria-hidden />
    </AccessBadgeChip>
  );
}

/**
 * PrivateBadge — flags a PRIVATE (personal, not-shared) node. KB inverts the default: the
 * space-wide broadcast (the common case) is badge-less, so the EXCEPTION worth surfacing is
 * the still-personal resource — a freshly created node is private by default (ADR-0017), and
 * the lock makes "this is yours only, not yet shared with the space" legible at a glance.
 */
export function PrivateBadge({ t }: { t: GraphTranslator }) {
  return (
    <AccessBadgeChip label={t('graph.drive.privateBadge')}>
      <Lock className="size-3" aria-hidden />
    </AccessBadgeChip>
  );
}

/**
 * SharedFolderHint — the load-bearing "placement = sharing" warning on a folder that
 * confers access (ADR-0023 §5 + §7a). Because there is NO subtractive detach, dropping
 * a node into a shared folder auto-shares it; for a `space`/`organization`-FLOOR folder
 * that is an AUTO-BROADCAST to everyone in the scope. The copy MUST name the actual
 * audience — and for a floor folder the SCOPE explicitly — never collapse a floor into a
 * generic "shared with N people" (the only guardrail against an accidental broadcast).
 * Precedence: a broadcast floor (the widest blast radius) is named even when the folder
 * ALSO has per-person grants. Pure display over the node's `visibility` + `sharedByMe`.
 */
export function SharedFolderHint({
  t,
  visibility,
  grantees,
}: {
  t: GraphTranslator;
  visibility: ResourceFloor | undefined;
  grantees: SharedByMeEntry['grantees'];
}) {
  const text =
    visibility === 'organization'
      ? t('graph.drive.sharedFolderHintOrganization')
      : visibility === 'space'
        ? t('graph.drive.sharedFolderHintSpace')
        : grantees.length === 1
          ? t('graph.drive.sharedFolderHintPeople', {
              name: grantees[0]!.displayName,
            })
          : grantees.length > 1
            ? t('graph.drive.sharedFolderHintPeopleCount', {
                count: grantees.length,
              })
            : null;
  if (text == null) {
    return null;
  }
  return (
    <div className="text-muted-foreground mt-1 flex items-start gap-1.5 text-[11px]">
      <Info className="mt-px size-3 shrink-0" aria-hidden />
      {/* Clamp so an unusually long hint can never inflate the fixed-height tile. */}
      <span className="line-clamp-2">{text}</span>
    </div>
  );
}
