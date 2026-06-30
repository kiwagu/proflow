'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { X } from 'lucide-react';
import * as React from 'react';

import { type Containment } from '@/app/graph/containment';
import { NodeActionsMenu } from '@/app/graph/node-actions-menu';
import type {
  KbAttributes,
  ResourceFloor,
  SharedByMeEntry,
  SpaceCapabilities,
} from '@/app/graph/graph-data.types';
import { iconForKind, kindLabel } from '@/app/graph/presentation';

import { AccessSection } from './access-section';
import { EditableDescription } from './editable-description';
import { sendJson } from './panel-fetch';
import { VersionsSection } from './versions-section';

/**
 * ResourcePanel — the node DETAIL panel ("Details"): single-click a node (or pick
 * Details from its `⋯` menu) → an INLINE right-side panel (the prototype's `aside`,
 * not a modal): a fixed-width column that lives in the workbench flex row and
 * shrinks the content beside it (no overlay, the grid stays interactive), closed by
 * the header `✕`. It carries the rich, edit-heavy surface.
 * Quick manipulations (new subfolder / rename / move / delete / SHARE) do NOT live
 * here — they are one click from the card / toolbar via the shared
 * {@link NodeActionsMenu}, which the header re-uses (sans its Details item) so the
 * same actions are reachable from inside the drawer too. Sharing (the broadcast
 * floor + cohort + per-user grants) is the unified Share dialog (ADR-0019 Fork 6),
 * opened from that menu's `Share` entry — NOT a separate panel section. Landed
 * sections:
 *   - header (kind + title) + the `⋯` action menu (Share lives here now)
 *   - editable, RAG-bound description (kb satellite)
 *
 * Deferred (their backend is not ported yet, so the section is omitted rather than
 * mocked — Law 3 / poc-no-fallbacks): tags / related / mini-graph (need the
 * neighborhood resolver), media (kb satellites), status transition, suggested links
 * (a RAG mock), view-in-graph (the graph view). They return with their backend.
 *
 * Purely presentational: it POSTs to the landed RLS routes; RLS is the authority.
 */

export type SelectedNode = {
  id: string;
  title: string;
  kind: string;
  status?: string;
};

export type ResourcePanelProps = {
  spaceId: string;
  messages: Record<string, string>;
  node: SelectedNode | null;
  /** KB satellite attributes of the node (description; media/link as they land). */
  attributes?: KbAttributes;
  containment: Containment;
  /** The viewer's own id — combined with `ownerUserId` to display-gate the `⋯` menu. */
  currentUserId: string | null;
  /** The selected node's owner (`knowledge_resources.owner_user_id`). */
  ownerUserId: string | null;
  /** The viewer's space-level knowledge verbs — display-gate the `⋯` menu (ADR-0006). */
  capabilities: SpaceCapabilities;
  /**
   * The node's BROADCAST FLOOR (`knowledge_resources.visibility`) — drives the read-only
   * "Access" section's visibility line (ADR-0023 §7b). Null when unknown (no meta loaded).
   */
  visibility?: ResourceFloor | null;
  /**
   * The DIRECT per-user grantees of THIS node (from `kbData.sharedByMe`, already labelled
   * via the co-member directory, ADR-0020) — the "Shared with N people" list. Empty when
   * the node has no direct grant.
   */
  grantees?: SharedByMeEntry['grantees'];
  /**
   * The ids the owner has shared OUT (the keys of `kbData.sharedByMe`) — the membership
   * test for the access-mirror ancestor walk (ADR-0023 §7b): a node is visible via an
   * "Inherited from {folder}" line when a granted ANCESTOR is in this set. SAME source as
   * the card badge, so the panel summary can never diverge from it.
   */
  sharedByMeIds?: Set<string>;
  /**
   * Each node's broadcast FLOOR (`knowledge_resources.visibility`) keyed by id — the
   * read-side lookup for the access-mirror BROADCAST walk (ADR-0023 §7b). The panel runs
   * `broadcastOut` over it + `containment` to name an INHERITED broadcast ("Broadcast via
   * folder {X}"), the exact mirror of the card globe badge. SAME source as the card, so
   * the panel and badge can never diverge. Empty map → no inherited-broadcast detection.
   */
  visibilityById?: Map<string, ResourceFloor>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-run the server resolve after a mutation (the workbench refreshes). */
  onMutated: () => void;
  /** Edit a text node directly (the workbench's edit launcher). */
  onEdit?: (nodeId: string) => void;
  /** Reveal this node in the KB containment tree — jump to the 'kb' lens at the node's
   * parent folder so its position among siblings is visible. Optional; only the workbench
   * (which owns navigation) provides it. */
  onOpenInKb?: (nodeId: string) => void;
};

export function ResourcePanel({
  spaceId,
  messages,
  node,
  attributes,
  containment,
  currentUserId,
  ownerUserId,
  capabilities,
  visibility,
  grantees,
  sharedByMeIds,
  visibilityById,
  open,
  onOpenChange,
  onMutated,
  onEdit,
  onOpenInKb,
}: ResourcePanelProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);
  const [busy, setBusy] = React.useState(false);

  if (!node || !open) {
    return null;
  }
  // Share = audience management (ADR-0019 §4): owner-sovereign OR the space access verb —
  // mirrors the per-user-grant/cohort RLS authority. The "Manage access" affordance is
  // shown on the same gate the ⋯ Share item uses (display courtesy; RLS re-checks).
  const owned = ownerUserId != null && ownerUserId === currentUserId;
  const canShare = owned || capabilities.canAccess;

  // Description save refreshes WITHOUT closing — the panel stays open with the
  // updated text (the user may keep editing).
  async function onSaveDescription(body: string) {
    setBusy(true);
    const ok = await sendJson('/author/graph/attributes', {
      attribute: 'description',
      spaceId,
      nodeId: node!.id,
      body,
    });
    setBusy(false);
    if (ok) {
      onMutated();
    }
  }

  return (
    <aside
      aria-label={node.title}
      className="bg-card motion-safe:animate-in motion-safe:slide-in-from-right-4 flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-l motion-safe:duration-200"
    >
      {/* header — icon + kind + actions + close. Same vertical rhythm as the main
          toolbar (`py-3` over 32px-tall controls) so the panel's bottom border
          lines up with the content toolbar's across the split. */}
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <span
          aria-hidden
          className="bg-muted grid size-8 shrink-0 place-items-center rounded-md"
        >
          {React.createElement(iconForKind(node.kind), {
            className: 'text-muted-foreground size-[17px]',
          })}
        </span>
        <span className="text-muted-foreground flex-1 text-xs tracking-wide uppercase">
          {kindLabel(t, node.kind)}
        </span>
        {/* Same action menu as the cards — panel = "Details", so no Details item. */}
        <NodeActionsMenu
          spaceId={spaceId}
          t={t}
          node={node}
          containment={containment}
          currentUserId={currentUserId}
          ownerUserId={ownerUserId}
          capabilities={capabilities}
          onMutated={onMutated}
          onActed={() => onOpenChange(false)}
          onEdit={
            node.kind === 'text' && onEdit ? () => onEdit(node.id) : undefined
          }
          onOpenInKb={onOpenInKb}
        />
        <Hint label={t('graph.panel.close')}>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label={t('graph.panel.close')}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </Hint>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold tracking-tight">{node.title}</h2>
          {node.status ? (
            <div>
              <Badge variant="outline">{node.status}</Badge>
            </div>
          ) : null}
        </div>

        <EditableDescription
          t={t}
          value={attributes?.description ?? ''}
          nodeId={node.id}
          disabled={busy}
          onSave={onSaveDescription}
        />

        <AccessSection
          t={t}
          spaceId={spaceId}
          node={node}
          containment={containment}
          currentUserId={currentUserId}
          ownerUserId={ownerUserId}
          canShare={canShare}
          visibility={visibility ?? null}
          grantees={grantees ?? []}
          sharedByMeIds={sharedByMeIds ?? new Set()}
          visibilityById={visibilityById ?? new Map()}
          onMutated={onMutated}
        />
        {node.kind === 'text' ? (
          <VersionsSection
            key={node.id}
            t={t}
            spaceId={spaceId}
            nodeId={node.id}
            onMutated={onMutated}
          />
        ) : null}
      </div>
    </aside>
  );
}
