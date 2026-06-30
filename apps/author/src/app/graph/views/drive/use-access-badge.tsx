'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import * as React from 'react';

import {
  broadcastOut,
  sharedOut,
  type Containment,
} from '@/app/graph/containment';
import type {
  NodeMeta,
  ResourceFloor,
  SharedByMeEntry,
} from '@/app/graph/graph-data.types';
import {
  BroadcastBadge,
  PrivateBadge,
  SharedOutBadge,
} from '@/app/graph/views/drive/badges';

/**
 * useAccessBadge — the access-mirror predicate family (ADR-0023 §7) lifted out of the
 * Drive view as one cohesive unit, so the grid card and the list row read access through
 * the SAME source and can never diverge.
 *
 * - `isGranted(id)` — the owner authored a DIRECT per-user grant on the node
 *   (`id ∈ sharedByMe`). The badge marks a node shown-as-shared IFF it OR a granted
 *   ANCESTOR folder is shared (`sharedOut` walks the loaded `contains` forest). Same
 *   source the panel's Access summary reads, so badge ≡ panel ≡ predicate.
 * - `accessStatus(id)` — GLOBE (broadcast) outranks PEOPLE (targeted) outranks NONE
 *   (private). Globe precedence applied once, here; returns the resolved
 *   `sharedOut`/`broadcastOut` verdicts so each badge can name its audience.
 * - `renderAccessBadge(id)` — the per-card/per-row status badge. KB is SPACE-FIRST: a
 *   space-wide broadcast is the typical audience → NO badge; only the EXCEPTIONS flag
 *   (org-wide GLOBE, targeted PEOPLE, and PRIVATE for the personal default → LOCK).
 *
 * Pure DISPLAY over the RLS-seeded `sharedByMe` / node meta / forest — never a fence.
 */
export function useAccessBadge({
  t,
  containment,
  metaByItem,
  sharedByMeByResource,
}: {
  t: GraphTranslator;
  containment: Containment;
  metaByItem: Record<string, NodeMeta>;
  sharedByMeByResource: Map<string, SharedByMeEntry['grantees']>;
}) {
  const isGranted = React.useCallback(
    (id: string) => sharedByMeByResource.has(id),
    [sharedByMeByResource]
  );

  const floorOf = React.useCallback(
    (id: string): ResourceFloor | undefined => metaByItem[id]?.visibility,
    [metaByItem]
  );

  const accessStatus = React.useCallback(
    (id: string) => {
      const broadcast = broadcastOut(containment, id, floorOf);
      const shared = sharedOut(containment, id, isGranted);
      const state: 'broadcast' | 'targeted' | 'private' = broadcast.isBroadcast
        ? 'broadcast'
        : shared.isShared
          ? 'targeted'
          : 'private';
      return { state, broadcast, shared } as const;
    },
    [containment, floorOf, isGranted]
  );

  const renderAccessBadge = React.useCallback(
    (id: string): React.ReactNode => {
      const { state, broadcast, shared } = accessStatus(id);
      if (state === 'broadcast') {
        // Space-wide broadcast = the typical KB default → no badge. Only org-wide flags.
        if (broadcast.scope === 'organization') {
          return (
            <BroadcastBadge
              t={t}
              scope="organization"
              broadcastViaTitle={broadcast.broadcastVia?.title ?? null}
            />
          );
        }
        return undefined;
      }
      if (state === 'targeted') {
        return (
          <SharedOutBadge
            t={t}
            direct={shared.direct}
            grantees={sharedByMeByResource.get(id) ?? []}
            inheritedFromTitle={shared.inheritedFrom?.title ?? null}
          />
        );
      }
      // private — personal, not shared (the default at creation); flag it with the lock.
      return <PrivateBadge t={t} />;
    },
    [accessStatus, sharedByMeByResource, t]
  );

  return { isGranted, accessStatus, renderAccessBadge } as const;
}
