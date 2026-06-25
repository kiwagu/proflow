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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Check, Link2, Search, UserRound, Users, X } from 'lucide-react';
import * as React from 'react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import type {
  GrantableMember,
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
  members: GrantableMember[];
};

const EMPTY_DATA: ShareData = {
  floor: null,
  choices: [],
  grants: [],
  members: [],
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

  // People-picker search (ADR-0020 §7b): the directory drives search SERVER-side
  // and is hard-bounded (≤50). `query` is the raw input; `members`/`searching`
  // track the debounced fetch keyed on it — we never filter a full client list.
  const [query, setQuery] = React.useState('');
  const [members, setMembers] = React.useState<GrantableMember[]>([]);
  const [searching, setSearching] = React.useState(false);

  const buildUrl = React.useCallback(
    (q?: string) => {
      const params = new URLSearchParams({
        space_id: spaceId,
        node_id: node.id,
      });
      const trimmed = q?.trim();
      if (trimmed) {
        params.set('q', trimmed);
      }
      return `/author/graph/visibility?${params.toString()}`;
    },
    [spaceId, node.id]
  );

  // Members-only fetch keyed on the search term. The route returns the bounded
  // directory result (empty/blank `q` → the starter list); we replace ONLY the
  // members slice so floor/cohorts/grants stay put while the user types.
  const fetchMembers = React.useCallback(
    async (q: string) => {
      setSearching(true);
      try {
        const res = await fetch(buildUrl(q));
        if (res.ok) {
          const next = (await res.json()) as ShareData;
          setMembers(next.members ?? []);
        }
      } finally {
        setSearching(false);
      }
    },
    [buildUrl]
  );

  const reload = React.useCallback(async () => {
    const res = await fetch(buildUrl());
    if (res.ok) {
      const next = (await res.json()) as ShareData;
      setData(next);
      setMembers(next.members ?? []);
      setLoadFailed(false);
    } else {
      setData(EMPTY_DATA);
      setMembers([]);
      setLoadFailed(true);
    }
  }, [buildUrl]);

  // (Re)load every time the dialog opens for a node, so a stale audience never
  // shows after a grant elsewhere. Reset the search to the starter list.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    setData(null);
    setMembers([]);
    setQuery('');
    setLoadFailed(false);
    setCopied(false);
    void reload();
  }, [open, reload]);

  // Debounced server-side search: refetch the bounded members list ~280ms after
  // the user stops typing. Skipped before the initial load (data == null); a
  // blank query refetches the bounded starter list (clearing the box restores
  // it). Search is always server-driven — never a client filter of a full list.
  React.useEffect(() => {
    if (!open || data === null) {
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchMembers(query);
    }, 280);
    return () => window.clearTimeout(handle);
  }, [query, open, data, fetchMembers]);

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
    // Reload the full audience (floor/cohorts/grants), then re-run the members
    // fetch under the ACTIVE query so a grant made mid-search keeps the user's
    // current result set (the granted person drops out of the picker, caller-side).
    await reload();
    if (query.trim() !== '') {
      await fetchMembers(query);
    }
    setWorking(false);
    onMutated();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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

        <div className="flex flex-col gap-5">
          {/* (1) Broadcast floor — the single per-resource dial (ADR-0017 §1.5). */}
          <section className="flex flex-col gap-2">
            <SectionLabel icon={<Users className="size-3" aria-hidden />}>
              {t('graph.share.floorSection')}
            </SectionLabel>
            <Select
              value={floor ?? undefined}
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

          {/* (2) Who has access — owner (read-only) + cohorts + per-user grants. */}
          <section className="flex flex-col gap-2">
            <SectionLabel icon={<UserRound className="size-3" aria-hidden />}>
              {t('graph.share.peopleSection')}
            </SectionLabel>
            <ul className="flex flex-col gap-1">
              {/* Owner — always present, never revocable (intrinsic, ADR-0019 §2). */}
              <OwnerRow
                t={t}
                ownerUserId={ownerUserId}
                currentUserId={currentUserId}
              />
              {/* Per-user grants. */}
              {grants.map((grant) => (
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
              {linkedCohorts.map((cohort) => (
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

          {/* (3) Add access — cohort picker + people-picker (per-user grant). */}
          <section className="flex flex-col gap-2">
            <SectionLabel icon={<Check className="size-3" aria-hidden />}>
              {t('graph.share.addSection')}
            </SectionLabel>
            {/* People-picker — a searchable, debounced directory combobox over
                grantable members (ADR-0020 §7b). Search is SERVER-driven and
                hard-bounded (≤50); selecting a row POSTs a per-user grant. */}
            <PeoplePicker
              t={t}
              query={query}
              onQueryChange={setQuery}
              members={members}
              searching={searching}
              loaded={data !== null}
              disabled={working}
              onPick={(userId) => grantUser(userId)}
            />
            {/* Cohort-picker — existing add-control, folded in. */}
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
          </section>
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

/**
 * Searchable people-picker (ADR-0020 §7b). A debounced search Input over the
 * co-member directory: typing refetches the bounded (≤50) members list
 * server-side (never a client filter); each result is a two-line row
 * (display_name primary + email secondary). Selecting a row grants the user.
 * Empty query shows the bounded starter list; a query with no hits shows a
 * "no matches" state; an in-flight search shows a loading line.
 *
 * Built on the repo's existing shadcn primitives (Input + a results list inside
 * the dialog) rather than a new `cmdk`/Popover dependency — there is no Command
 * combobox primitive in @workspace/ui, and the list lives inline in the dialog,
 * so this matches the surrounding composition (shadcn-patterns-required).
 */
function PeoplePicker({
  t,
  query,
  onQueryChange,
  members,
  searching,
  loaded,
  disabled,
  onPick,
}: {
  t: GraphTranslator;
  query: string;
  onQueryChange: (next: string) => void;
  members: GrantableMember[];
  searching: boolean;
  loaded: boolean;
  disabled: boolean;
  onPick: (userId: string) => void;
}) {
  const trimmed = query.trim();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          className="pl-8"
          value={query}
          disabled={disabled}
          placeholder={t('graph.share.searchPeople')}
          aria-label={t('graph.share.searchPeople')}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      {searching ? (
        <p className="text-muted-foreground px-1 text-xs" role="status">
          {t('graph.share.searching')}
        </p>
      ) : members.length > 0 ? (
        <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {members.map((member) => (
            <li key={member.userId}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(member.userId)}
                className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
              >
                <EntityAvatar name={member.displayName} className="size-7" />
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
              </button>
            </li>
          ))}
        </ul>
      ) : !loaded ? null : trimmed !== '' ? (
        <p className="text-muted-foreground px-1 text-xs">
          {t('graph.share.noMatches', { query: trimmed })}
        </p>
      ) : (
        <p className="text-muted-foreground px-1 text-xs">
          {t('graph.share.noMembers')}
        </p>
      )}
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
