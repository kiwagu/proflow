'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
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
import { FieldError } from '@workspace/ui/components/field';
import { Hint } from '@workspace/ui/components/hint';
import { Input } from '@workspace/ui/components/input';
import { AsyncSearchPicker } from '@workspace/ui/components/platform/async-search-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Check, Link2, Search, UserRound, Users } from 'lucide-react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import type {
  GrantableMember,
  ResourceFloor,
} from '@/app/graph/graph-data.types';

import { CohortRow, OwnerRow, PersonRow, SectionLabel } from './share-rows';
import { useShare } from './use-share';

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
 * The share STATE + grant/revoke/floor/fetch engine lives in {@link useShare}; this
 * component is the presentation shell — it renders the rows and wires the hook.
 * Bodies are typed from the route's exported zod contracts — never redefined here
 * (zod-schema-first-contracts).
 */
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
  const {
    data,
    loadFailed,
    working,
    copied,
    pickerEpoch,
    assignedQuery,
    setAssignedQuery,
    floor,
    availableCohorts,
    linkedCohorts,
    showAssignedSearch,
    shownGrants,
    shownCohorts,
    fetchMembersPage,
    handleOpenChange,
    changeFloor,
    linkCohort,
    unlinkCohort,
    grantUser,
    revokeUser,
    markCopied,
  } = useShare({ spaceId, open, node, onOpenChange, onMutated });

  // Copy link — PURE navigation (Fork 4). A deep-link to the node in the Drive
  // (`?doc=<id>`); it grants nothing, RLS re-evaluates access at open time.
  async function copyLink(): Promise<void> {
    const url = `${window.location.origin}${AUTHOR_BASE_PATH}/graph?doc=${encodeURIComponent(node.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      markCopied();
    } catch {
      // Clipboard blocked (insecure context / denied) — no-op; the affordance is
      // a convenience, never load-bearing.
    }
  }

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
          <FieldError className="text-destructive text-sm">
            {t('graph.share.loadError')}
          </FieldError>
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
