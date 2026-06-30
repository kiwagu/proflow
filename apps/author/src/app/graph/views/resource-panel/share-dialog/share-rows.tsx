'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';
import { Hint } from '@workspace/ui/components/hint';
import { SectionLabel as UiSectionLabel } from '@workspace/ui/components/section-label';
import { Users, X } from 'lucide-react';
import * as React from 'react';

/** Uppercase section label with a leading icon — the Share dialog's three audience
 * controls (floor / who-has-access / add) are each titled with this. A thin alias over
 * the shared `SectionLabel` primitive fixing the dialog's flex+gap layout. */
export function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <UiSectionLabel className="flex items-center gap-1.5" icon={icon}>
      {children}
    </UiSectionLabel>
  );
}

/** Owner row — always shown, read-only (the owner can never lose their own node). */
export function OwnerRow({
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
export function PersonRow({
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
export function CohortRow({
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
