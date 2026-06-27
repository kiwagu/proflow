'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';
import { Hint } from '@workspace/ui/components/hint';
import { Input } from '@workspace/ui/components/input';
import {
  AsyncSearchPicker,
  type AsyncSearchPage,
} from '@workspace/ui/components/platform/async-search-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';
import { Check, Link2, Search, UserRound, Users, X } from 'lucide-react';
import * as React from 'react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import type {
  GrantableMember,
  GrantableMembersPage,
  ResourceFloor,
  ScopeChoice,
  UserGrant,
} from '@/app/graph/graph-data.types';
import type {
  CohortShareBody,
  UserShareBody,
} from '@/app/graph/visibility/route';

/**
 * ShareDialog — the ONE Share surface (ADR-0019 Fork 6). It folds the THREE
 * audience controls of a node into a single dialog, mirroring ADR-0017's "ONE
 * broadcast floor + N additive grants" mental model:
 *   (1) the broadcast floor selector (private / space / organization — PATCH);
 *   (2) "Who has access" — owner (read-only) + cohort grants + per-user grants,
 *       each non-owner row with a Revoke control (DELETE);
 *   (3) an add-control — the cohort picker + a NEW people-picker over grantable
 *       members (POST `{grantType:'user',…}`).
 *
 * The cohort "Visibility" section previously living in {@link ResourcePanel} is
 * folded IN here — there is no second floor/cohort control. RLS is the sole
 * authority: this dialog only POSTs/PATCHes/DELETEs the landed `/visibility`
 * route; a no-op under RLS (a non-owner without `space.knowledge.access`) simply
 * reverts on the reload. "Copy link" is pure navigation (Fork 4) — it grants
 * nothing; the recipient still needs access.
 *
 * Bodies are typed from the route's exported zod contracts
 * ({@link CohortShareBody} / {@link UserShareBody}) — never redefined here
 * (zod-schema-first-contracts).
 */

type ShareData = {
  floor: ResourceFloor | null;
  choices: ScopeChoice[];
  grants: UserGrant[];
  // The route's `members` is ONE keyset page (ADR-0021 Part A): { items, nextCursor,
  // total }. The reusable `AsyncSearchPicker` (Wave 1b) consumes the full page —
  // cursor-paged, with a "+N more" count + "Show more". The floor/cohort load reads
  // `members` for nothing now (the picker fetches its own pages); it rides along.
  members: GrantableMembersPage;
};

/** Page size for the people-picker (ADR-0021 §A3 — a small fixed page of 5 that
 * invites narrowing by typing; the server hard-caps at 50). */
const MEMBERS_PAGE_SIZE = 5;

const EMPTY_PAGE: GrantableMembersPage = {
  items: [],
  nextCursor: null,
  total: 0,
};

const EMPTY_DATA: ShareData = {
  floor: null,
  choices: [],
  grants: [],
  members: EMPTY_PAGE,
};

async function send(
  body: unknown,
  method: 'POST' | 'PATCH' | 'DELETE'
): Promise<boolean> {
  const res = await fetch('/author/graph/visibility', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function ShareDialog({
  t,
  spaceId,
  open,
  onOpenChange,
  node,
  currentUserId,
  ownerUserId,
  onMutated,
}: {
  t: GraphTranslator;
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: { id: string; title: string };
  /** Viewer's own id — labels the per-grant provenance ("Shared by you") and the
   * owner row; a display decision only, RLS is the authority. */
  currentUserId: string | null;
  /** The node's owner (`knowledge_resources.owner_user_id`). `null` → ownerless. */
  ownerUserId: string | null;
  /** Re-resolve the canvas after any grant change (a grant widens who can see it). */
  onMutated: () => void;
}) {
  const [data, setData] = React.useState<ShareData | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  // Bumped after every grant/revoke to REMOUNT the picker (`key`), forcing it back
  // to page 1 for a fresh blank-query starter list — the just-granted person drops
  // out (the directory already excludes them server-side via p_exclude, ADR-0021 A5).
  const [pickerEpoch, setPickerEpoch] = React.useState(0);
  // Local client-side filter over the ASSIGNED list (grants + cohorts) — surfaced only
  // when the assigned set is large (>10) so a long audience stays scannable, no server
  // round-trip (the owner row is always kept).
  const [assignedQuery, setAssignedQuery] = React.useState('');
  // A share mutation re-resolves the canvas (and `router.refresh()`es), which would
  // re-mount this dialog and close it mid-task. Defer that refresh to dialog CLOSE so
  // several people can be assigned in one sitting; the dialog's own `reload()` still
  // reflects each grant immediately.
  const mutatedRef = React.useRef(false);

  const buildUrl = React.useCallback(
    (params: { q?: string; cursor?: string | null } = {}) => {
      const search = new URLSearchParams({
        space_id: spaceId,
        node_id: node.id,
      });
      const trimmed = params.q?.trim();
      if (trimmed) {
        search.set('q', trimmed);
      }
      if (params.cursor) {
        search.set('cursor', params.cursor);
      }
      search.set('limit', String(MEMBERS_PAGE_SIZE));
      return `/author/graph/visibility?${search.toString()}`;
    },
    [spaceId, node.id]
  );

  // One page of grantable members for the AsyncSearchPicker. The route returns the
  // full Share payload; we extract ONLY the `members` keyset page (the floor/cohort/
  // grant slices are untouched by paging — they are reloaded by `reload()` after a
  // mutation, never by the picker). A failed fetch yields an empty page (no leak).
  const fetchMembersPage = React.useCallback(
    async (
      q: string,
      cursor: string | null
    ): Promise<AsyncSearchPage<GrantableMember>> => {
      const res = await fetch(buildUrl({ q, cursor }));
      if (!res.ok) {
        return { items: [], nextCursor: null, total: 0 };
      }
      const payload = (await res.json()) as ShareData;
      const page: GrantableMembersPage = payload.members ?? EMPTY_PAGE;
      return {
        items: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      };
    },
    [buildUrl]
  );

  const reload = React.useCallback(async () => {
    const res = await fetch(buildUrl());
    if (res.ok) {
      const next = (await res.json()) as ShareData;
      setData(next);
      setLoadFailed(false);
    } else {
      setData(EMPTY_DATA);
      setLoadFailed(true);
    }
  }, [buildUrl]);

  // Reset the dialog to its starter state on the closed→open transition — adjusted
  // during render ("you might not need an effect"), not in an effect. This remounts
  // the picker (epoch bump) and clears any prior audience/flags so a stale set never
  // shows after a grant elsewhere.
  if (useValueChanged(open) && open) {
    setData(null);
    setLoadFailed(false);
    setCopied(false);
    setAssignedQuery('');
    setPickerEpoch((e) => e + 1);
  }

  // Genuine load effect: (re)fetch the audience while the dialog is open (and again
  // if the query changes), so the visible set is always fresh. It also clears the
  // deferred-refresh flag on open (a ref write — only valid here, not in render).
  // `reload` only setStates AFTER an awaited fetch, so this is not the synchronous
  // cascade the rule guards against.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    mutatedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async setState (post-fetch) inside an owned data-load effect
    void reload();
  }, [open, reload]);

  // Each mutation goes through the landed route, then reloads the audience AND
  // re-resolves the canvas (a grant changes who can see the node). A failed
  // (RLS-rejected) write is a clean no-op — the reload simply shows the unchanged
  // state, no fence leak.
  async function mutate(
    body: unknown,
    method: 'POST' | 'PATCH' | 'DELETE'
  ): Promise<void> {
    setWorking(true);
    await send(body, method);
    // Reload the full audience (floor/cohorts/grants), then remount the picker so it
    // refetches page 1 — the granted person drops out (the directory excludes them
    // server-side via p_exclude, ADR-0021 A5).
    await reload();
    setPickerEpoch((e) => e + 1);
    setWorking(false);
    // Mark dirty; the canvas refresh is flushed once on close (handleOpenChange) so the
    // dialog stays open across multiple assignments.
    mutatedRef.current = true;
  }

  // Flush the deferred canvas refresh exactly once, when the dialog actually closes.
  function handleOpenChange(next: boolean): void {
    if (!next && mutatedRef.current) {
      mutatedRef.current = false;
      onMutated();
    }
    onOpenChange(next);
  }

  function changeFloor(next: ResourceFloor): void {
    void mutate({ resourceId: node.id, visibility: next }, 'PATCH');
  }

  function linkCohort(scopeId: string): void {
    const body: CohortShareBody = {
      grantType: 'cohort',
      resourceId: node.id,
      scopeId,
    };
    void mutate(body, 'POST');
  }

  function unlinkCohort(scopeId: string): void {
    const body: CohortShareBody = {
      grantType: 'cohort',
      resourceId: node.id,
      scopeId,
    };
    void mutate(body, 'DELETE');
  }

  function grantUser(userId: string): void {
    const body: UserShareBody = {
      grantType: 'user',
      resourceId: node.id,
      userId,
    };
    void mutate(body, 'POST');
  }

  function revokeUser(userId: string): void {
    const body: UserShareBody = {
      grantType: 'user',
      resourceId: node.id,
      userId,
    };
    void mutate(body, 'DELETE');
  }

  // Copy link — PURE navigation (Fork 4). A deep-link to the node in the Drive
  // (`?doc=<id>`); it grants nothing, RLS re-evaluates access at open time.
  async function copyLink(): Promise<void> {
    const url = `${window.location.origin}${AUTHOR_BASE_PATH}/graph?doc=${encodeURIComponent(node.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context / denied) — no-op; the affordance is
      // a convenience, never load-bearing.
    }
  }

  const floor = data?.floor ?? null;
  const linkedCohorts = (data?.choices ?? []).filter((c) => c.linked);
  const availableCohorts = (data?.choices ?? []).filter((c) => !c.linked);
  const grants = data?.grants ?? [];

  // Local filter over the assigned list — only offered past 10 assignees. The owner row
  // is never filtered (it is the anchor, not an "assignee").
  const assignedCount = grants.length + linkedCohorts.length;
  const showAssignedSearch = assignedCount > 10;
  const aq = assignedQuery.trim().toLowerCase();
  const shownGrants = aq
    ? grants.filter(
        (g) =>
          g.displayName.toLowerCase().includes(aq) ||
          (g.email?.toLowerCase().includes(aq) ?? false)
      )
    : grants;
  const shownCohorts = aq
    ? linkedCohorts.filter((c) => c.name.toLowerCase().includes(aq))
    : linkedCohorts;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Fixed height (no jiggle); the audience + add-access share ONE inner scroll
          region (below) so a long list never clips the search input. `select-text`
          forces text-selectability even if a stuck Drive drag left `user-select:none`
          on <body> (it is inherited by this portaled dialog — see drive-dnd.ts). */}
      <DialogContent className="flex h-[48rem] max-h-[85vh] flex-col select-text sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('graph.share.title')}</DialogTitle>
          <DialogDescription>
            {t('graph.share.dialogDescription', { title: node.title })}
          </DialogDescription>
        </DialogHeader>

        {loadFailed ? (
          <p className="text-destructive text-sm" role="alert">
            {t('graph.share.loadError')}
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-5">
          {/* (1) Broadcast floor — the single per-resource dial (ADR-0017 §1.5). */}
          <section className="flex flex-col gap-2">
            <SectionLabel icon={<Users className="size-3" aria-hidden />}>
              {t('graph.share.floorSection')}
            </SectionLabel>
            <Select
              value={floor ?? ''}
              disabled={working || floor == null}
              onValueChange={(next) => changeFloor(next as ResourceFloor)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  {t('graph.panel.floorPrivate')}
                </SelectItem>
                <SelectItem value="space">
                  {t('graph.panel.floorSpace')}
                </SelectItem>
                <SelectItem value="organization">
                  {t('graph.panel.floorOrganization')}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {t('graph.share.floorHint')}
            </p>
          </section>

          {/* Who has access + Add access — each list owns its OWN scroll (assigned vs
              candidates) so neither pushes the other or the search input out of view;
              the floor above and the cohort/footer below stay pinned. */}
          <div className="flex min-h-0 flex-1 flex-col gap-5">
            {/* (2) Who has access — owner (read-only) + cohorts + per-user grants. The
                ASSIGNED list scrolls within its own cap. */}
            <section className="flex min-h-0 flex-col gap-2">
              <SectionLabel icon={<UserRound className="size-3" aria-hidden />}>
                {t('graph.share.peopleSection')}
              </SectionLabel>
              {/* Local filter over the assigned list — appears only past 10 assignees
                  (client-side, no fetch). */}
              {showAssignedSearch ? (
                <div className="relative">
                  <Search
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    className="h-8 pl-8"
                    value={assignedQuery}
                    placeholder={t('graph.share.filterAssigned')}
                    aria-label={t('graph.share.filterAssigned')}
                    onChange={(event) => setAssignedQuery(event.target.value)}
                  />
                </div>
              ) : null}
              {/* The ASSIGNED list — FIXED height so adding/removing people never jumps
                  the layout; it scrolls within. */}
              <ul className="flex h-40 flex-col gap-1 overflow-y-auto">
                {/* Owner — always present, never revocable (intrinsic, ADR-0019 §2). */}
                <OwnerRow
                  t={t}
                  ownerUserId={ownerUserId}
                  currentUserId={currentUserId}
                />
                {/* Per-user grants. */}
                {shownGrants.map((grant) => (
                  <PersonRow
                    key={grant.userId}
                    name={grant.displayName}
                    email={grant.email}
                    subtitle={
                      grant.grantedBy === currentUserId
                        ? t('graph.share.grantedByYou')
                        : t('graph.share.grantedByOther')
                    }
                    onRevoke={() => revokeUser(grant.userId)}
                    revokeLabel={t('graph.share.revoke')}
                    disabled={working}
                  />
                ))}
                {/* Cohort grants — folded in from the old Visibility section. */}
                {shownCohorts.map((cohort) => (
                  <CohortRow
                    key={cohort.id}
                    name={cohort.name}
                    badge={t('graph.share.cohortBadge')}
                    onRevoke={() => unlinkCohort(cohort.id)}
                    revokeLabel={t('graph.share.removeCohort')}
                    disabled={working}
                  />
                ))}
              </ul>
            </section>

            {/* (3) Add access — the candidate people-picker (per-user grant). Fills the
                remaining height; its results list owns the CANDIDATES scroll. */}
            <section className="flex min-h-0 flex-1 flex-col gap-2">
              <SectionLabel icon={<Check className="size-3" aria-hidden />}>
                {t('graph.share.addSection')}
              </SectionLabel>
              {/* People-picker — the reusable AsyncSearchPicker (ADR-0021 §A4) over the
                grantable-member directory: a debounced, cursor-paged search (page of 5
                + "+N more" + "Show more"), SERVER-driven and hard-bounded (≤50).
                Selecting a row POSTs a per-user grant; the `key` remounts it to page 1
                after each grant so the granted person drops out (p_exclude, A5). */}
              <AsyncSearchPicker<GrantableMember>
                key={pickerEpoch}
                fetchPage={fetchMembersPage}
                getKey={(member) => member.userId}
                onPick={(member) => grantUser(member.userId)}
                disabled={working}
                className="min-h-0 flex-1"
                listClassName="min-h-0 flex-1 overflow-y-auto"
                labels={{
                  searchPlaceholder: t('graph.share.searchPeople'),
                  searching: t('graph.share.searching'),
                  empty: t('graph.share.noMatchesAny'),
                  emptyQuery: t('graph.share.noMembers'),
                  showMore: t('graph.share.showMore'),
                  moreCount: (remaining) =>
                    t('graph.share.moreCount', { count: remaining }),
                }}
                renderItem={(member) => (
                  <>
                    <EntityAvatar
                      name={member.displayName}
                      className="size-7"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {member.displayName}
                      </span>
                      {member.email ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {member.email}
                        </span>
                      ) : null}
                    </div>
                  </>
                )}
              />
            </section>
          </div>

          {/* Share with a cohort — pinned BELOW the scroll region so it stays
              reachable no matter how long the audience list grows. */}
          {availableCohorts.length > 0 ? (
            <Select
              value=""
              disabled={working}
              onValueChange={(scopeId) => linkCohort(scopeId)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t('graph.panel.addCohort')} />
              </SelectTrigger>
              <SelectContent>
                {availableCohorts.map((cohort) => (
                  <SelectItem key={cohort.id} value={cohort.id}>
                    {cohort.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : data !== null && linkedCohorts.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('graph.share.noCohorts')}
            </p>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Copy link — pure navigation (Fork 4), left-aligned. */}
          <Hint label={t('graph.share.copyLinkHint')}>
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyLink()}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Link2 className="size-4" aria-hidden />
              )}
              {copied ? t('graph.share.copied') : t('graph.share.copyLink')}
            </Button>
          </Hint>
          <DialogClose asChild>
            <Button type="button">{t('graph.share.done')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] uppercase">
      {icon}
      {children}
    </div>
  );
}

/** Owner row — always shown, read-only (the owner can never lose their own node). */
function OwnerRow({
  t,
  ownerUserId,
  currentUserId,
}: {
  t: GraphTranslator;
  ownerUserId: string | null;
  currentUserId: string | null;
}) {
  const isYou = ownerUserId != null && ownerUserId === currentUserId;
  const name = isYou ? t('graph.panel.ownerYou') : t('graph.panel.ownerMember');
  return (
    <li className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
      <EntityAvatar name={name} className="size-7" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="text-muted-foreground text-xs">
          {t('graph.share.ownerRow')}
        </span>
      </div>
    </li>
  );
}

/** One per-user grant row — avatar + name (+ email disambiguator) + provenance +
 * a Revoke control. `email` is the secondary line resolved by the co-member
 * directory (ADR-0020); provenance moves into the avatar tooltip so the row keeps
 * to two lines (name + email). */
function PersonRow({
  name,
  email,
  subtitle,
  onRevoke,
  revokeLabel,
  disabled,
}: {
  name: string;
  email: string | null;
  subtitle: string;
  onRevoke: () => void;
  revokeLabel: string;
  disabled: boolean;
}) {
  return (
    <li className="hover:bg-muted/50 flex items-center gap-2.5 rounded-md px-1 py-1.5">
      <Hint label={subtitle}>
        <EntityAvatar name={name} className="size-7" />
      </Hint>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {email ?? subtitle}
        </span>
      </div>
      <Hint label={revokeLabel}>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive shrink-0"
          disabled={disabled}
          onClick={onRevoke}
          aria-label={revokeLabel}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </Hint>
    </li>
  );
}

/** One cohort grant row — folded in from the old Visibility section. */
function CohortRow({
  name,
  badge,
  onRevoke,
  revokeLabel,
  disabled,
}: {
  name: string;
  badge: string;
  onRevoke: () => void;
  revokeLabel: string;
  disabled: boolean;
}) {
  return (
    <li className="hover:bg-muted/50 flex items-center gap-2.5 rounded-md px-1 py-1.5">
      <span
        aria-hidden
        className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full"
      >
        <Users className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
        <Badge variant="secondary" className="shrink-0">
          {badge}
        </Badge>
      </div>
      <Hint label={revokeLabel}>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive shrink-0"
          disabled={disabled}
          onClick={onRevoke}
          aria-label={revokeLabel}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </Hint>
    </li>
  );
}
