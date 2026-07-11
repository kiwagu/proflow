'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { SectionLabel } from '@workspace/ui/components/section-label';
import { cn } from '@workspace/ui/lib/utils';
import {
  Clock,
  Database,
  Folder,
  House,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import {
  CreateResource,
  type CreateRequest,
} from '@/app/graph/create-resource.view';
import {
  childContent,
  childFolders,
  rootFolders,
  type Containment,
} from '@/app/graph/containment';
import type { DriveScope } from '@/app/graph/views/registry/projection-view.types';

/**
 * The SHARED Drive workbench left-rail nav — the SINGLE sidebar every Drive lens
 * renders through `WorkbenchShell.panel`, so the chrome cannot drift apart between
 * the projection lenses (Drive / Shared / Starred / …) and the substrate-capability
 * lenses (Search). It owns the "New" launcher (the `CreateResource` dialog), the
 * lens nav (`NAV_ITEMS` — For you / Knowledge base / Search / Shared / … / Trash,
 * the active one highlighted), and the "Sections" folder shortcuts.
 *
 * Extracted from `DriveProjectionView` so the lexical-search lens (`SearchView`)
 * sits in the IDENTICAL chrome as the projection lenses instead of a
 * full-width breakout — search is a first-class lens, not a separate surface. The
 * caller passes the already-built `Containment` (the workbench builds it once over
 * the resolved canvas; `DriveProjectionView` passes its possibly-narrowed
 * `treeContainment`), the active `scope`, and the navigation callbacks; the sidebar
 * is otherwise self-contained (it mounts its own `CreateResource` dialog).
 *
 * PURELY presentational: it never queries Supabase / the resolver —
 * authoring routes through `CreateResource` → the RLS write routes. RLS is the sole
 * authority; an ungranted user resolves to an empty tree and cannot author.
 */

/**
 * A sidebar filter. `scope` present = the item is WIRED to a canvas filter (the
 * active one highlights). `DriveScope` is the shared type (the workbench owns it in
 * the URL).
 */
type NavItem = {
  icon: LucideIcon;
  /** Stable React key / id for the row. */
  key: string;
  /** Resolves the label with a LITERAL i18n key (keeps keys statically extractable
   * even though the nav is data-driven). */
  label: (t: GraphTranslator) => string;
  scope?: DriveScope;
};

const NAV_ITEMS: readonly NavItem[] = [
  {
    icon: House,
    key: 'navHome',
    label: (t) => t('graph.drive.navHome'),
    scope: 'home',
  },
  {
    icon: Database,
    key: 'navKnowledgeBase',
    label: (t) => t('graph.drive.navKnowledgeBase'),
    scope: 'kb',
  },
  {
    icon: Search,
    key: 'navSearch',
    label: (t) => t('graph.drive.navSearch'),
    scope: 'search',
  },
  {
    icon: Users,
    key: 'navShared',
    label: (t) => t('graph.drive.navShared'),
    scope: 'shared',
  },
  {
    icon: Send,
    key: 'navSharedByMe',
    label: (t) => t('graph.drive.navSharedByMe'),
    scope: 'shared-by-me',
  },
  {
    icon: Clock,
    key: 'navRecent',
    label: (t) => t('graph.drive.navRecent'),
    scope: 'recent',
  },
  {
    icon: Star,
    key: 'navStarred',
    label: (t) => t('graph.drive.navStarred'),
    scope: 'starred',
  },
  {
    icon: Trash2,
    key: 'navTrash',
    label: (t) => t('graph.drive.navTrash'),
    scope: 'trash',
  },
];

export type DriveSidebarProps = {
  t: GraphTranslator;
  /** The active lens scope — drives which nav item highlights. */
  scope: DriveScope;
  /** Switch the lens scope (the workbench writes it to the URL). */
  onScopeChange: (scope: DriveScope) => void;
  /** Navigate to a folder (null → root). The "Sections" roots + the KB item use it. */
  onNavigate: (folderId: string | null) => void;
  /** The current folder location (highlights the active "Sections" root). */
  folderId: string | null;
  /** The containment forest to build the "Sections" roots + child counts from. */
  containment: Containment;
  /** Active space id — the `CreateResource` write target. */
  spaceId?: string;
  /** The EFFECTIVE per-org max-upload size in bytes, threaded to the
   * `CreateResource` picker for its client-side "too large" pre-validation hint. */
  maxUploadBytes?: number;
  /** Re-resolve after a create (the workbench refreshes). */
  onMutated: () => void;
};

/**
 * The shared Drive left-rail. Renders the nav + the "Sections" folder roots, and
 * mounts its own `CreateResource` dialog (the "New" launcher). `scope` highlights
 * the active lens; `folderId` highlights the active section root.
 */
export function DriveSidebar({
  t,
  scope,
  onScopeChange,
  onNavigate,
  folderId,
  containment,
  spaceId,
  maxUploadBytes,
  onMutated,
}: DriveSidebarProps) {
  const [createRequest, setCreateRequest] =
    React.useState<CreateRequest | null>(null);

  const roots = rootFolders(containment);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Button
          onClick={() => setCreateRequest({ parentFolderId: folderId })}
          className="mb-2 w-full justify-start"
        >
          <Plus className="size-4" aria-hidden />
          {t('graph.create.new')}
        </Button>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          // A wired item highlights when its scope is the active one ('kb' stays
          // active even inside a folder).
          const active = item.scope === scope;
          return (
            <Button
              key={item.key}
              variant="ghost"
              onClick={() => {
                // Every wired lens switches via the scope owner (the workbench roots
                // the folder on a lens switch). The KB lens must NOT use
                // `navigate(null)`: in the advanced Shared tree
                // `goFolder(null)` deliberately STAYS on the Shared lens, so routing
                // 'kb' through it would trap the user there.
                if (!item.scope) {
                  onNavigate(null);
                  return;
                }
                onScopeChange(item.scope);
              }}
              data-active={active}
              className={cn(
                'h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left font-normal',
                'hover:bg-accent text-foreground',
                active && 'bg-accent font-medium'
              )}
            >
              <Icon
                className={cn(
                  'size-4',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
                aria-hidden
              />
              {item.label(t)}
            </Button>
          );
        })}
        <div className="bg-border my-2 h-px" />
        <SectionLabel density="compact" className="px-2 py-1">
          {t('graph.drive.sections')}
        </SectionLabel>
        {roots.map((root) => (
          <Button
            key={root.id}
            variant="ghost"
            onClick={() => onNavigate(root.id)}
            data-active={folderId === root.id}
            className={cn(
              'h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left font-normal',
              'hover:bg-accent',
              folderId === root.id && 'bg-accent font-medium'
            )}
          >
            <Folder className="text-muted-foreground size-4" aria-hidden />
            <span className="flex-1 truncate">{root.title}</span>
            <span className="text-muted-foreground text-[11px]">
              {childFolders(containment, root.id).length +
                childContent(containment, root.id).length}
            </span>
          </Button>
        ))}
      </div>

      {/* The "New" launcher's dialog. Only mounted with a real space — the rail's
          callers (`DriveProjectionView` / `SearchView`) already early-return on a
          missing space, so this guard is belt-and-braces for the prop's wider type. */}
      {spaceId ? (
        <CreateResource
          spaceId={spaceId}
          t={t}
          containment={containment}
          maxUploadBytes={maxUploadBytes}
          request={createRequest}
          onOpenChange={(open) => {
            if (!open) {
              setCreateRequest(null);
            }
          }}
          onCreated={onMutated}
        />
      ) : null}
    </>
  );
}
