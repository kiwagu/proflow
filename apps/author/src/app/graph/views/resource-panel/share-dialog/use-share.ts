'use client';

import type { AsyncSearchPage } from '@workspace/ui/components/platform/async-search-picker';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';
import * as React from 'react';

import type {
  GrantableMember,
  GrantableMembersPage,
  ResourceFloor,
} from '@/app/graph/graph-data.types';
import type {
  CohortShareBody,
  UserShareBody,
} from '@/app/graph/visibility/route';

import { sendJson } from '../panel-fetch';
import {
  EMPTY_DATA,
  EMPTY_PAGE,
  MEMBERS_PAGE_SIZE,
  type ShareData,
} from './share-data';

const VISIBILITY_PATH = '/author/graph/visibility';

/** Arguments threaded into {@link useShare} from the dialog props — identity + the
 * deferred canvas refresh; the open/close lifecycle drives reload + reset. */
type UseShareArgs = {
  spaceId: string;
  open: boolean;
  node: { id: string; title: string };
  onOpenChange: (open: boolean) => void;
  /** Re-resolve the canvas after any grant change (a grant widens who can see it). */
  onMutated: () => void;
};

/**
 * useShare — the Share dialog's state + mutation engine. It owns the audience load
 * (floor / cohorts / grants), the people-picker page fetch, and every grant / revoke /
 * floor write through the landed `/visibility` route (mechanism only — RLS is the
 * authority; a RLS-rejected write is a clean no-op the reload reflects). The dialog
 * shell consumes this and renders rows; it holds no fetch logic of its own.
 */
export function useShare({
  spaceId,
  open,
  node,
  onOpenChange,
  onMutated,
}: UseShareArgs) {
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
      return `${VISIBILITY_PATH}?${search.toString()}`;
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
    await sendJson(VISIBILITY_PATH, body, method);
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

  function markCopied(): void {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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

  return {
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
  };
}
