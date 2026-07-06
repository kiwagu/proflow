'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Hint } from '@workspace/ui/components/hint';
import { Radio, UserCheck, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import type { ShareMechanism } from '@/app/graph/graph-data.types';

/**
 * The "Shared with me" mechanism presentation table (ADR-0021 Part C) — maps each
 * winning mechanism to its badge icon, its short label, and a Hint explaining it. The
 * order is the precedence order (most deliberate first: personal > cohort > broadcast)
 * — it drives BOTH the facet chip row sequence and which chips appear (a chip shows
 * only when its mechanism is present in the shared set). Labels/hints are LITERAL i18n
 * keys so they stay statically extractable. DISPLAY only — the mechanism is precomputed
 * server-side under RLS; the view never re-derives access.
 */
export const SHARE_MECHANISM_ORDER = [
  'personal',
  'cohort',
  'broadcast',
] as const;

export const SHARE_MECHANISM_META: Record<
  ShareMechanism,
  {
    icon: LucideIcon;
    label: (t: GraphTranslator) => string;
    hint: (t: GraphTranslator) => string;
  }
> = {
  personal: {
    icon: UserCheck,
    label: (t) => t('graph.drive.mechPersonal'),
    hint: (t) => t('graph.drive.mechPersonalHint'),
  },
  cohort: {
    icon: UsersRound,
    label: (t) => t('graph.drive.mechCohort'),
    hint: (t) => t('graph.drive.mechCohortHint'),
  },
  broadcast: {
    icon: Radio,
    label: (t) => t('graph.drive.mechBroadcast'),
    hint: (t) => t('graph.drive.mechBroadcastHint'),
  },
};

/**
 * ShareMechanismBadge — the per-card "why is this shared with me" badge in the
 * 'shared' (incoming) lens ONLY (ADR-0021 Part C). A compact shadcn `Badge` (the same
 * chip primitive the cards already use) + a small lucide icon + the mechanism label,
 * wrapped in a `Hint` that explains the mechanism (the label alone is terse). The
 * mechanism is the precomputed WINNING one (personal > cohort > broadcast) — DISPLAY
 * over an already-resolved, already-fenced set, never a recomputed access decision.
 */
export function ShareMechanismBadge({
  t,
  mechanism,
}: {
  t: GraphTranslator;
  mechanism: ShareMechanism;
}) {
  const meta = SHARE_MECHANISM_META[mechanism];
  const Icon = meta.icon;
  const label = meta.label(t);
  return (
    <Hint label={meta.hint(t)}>
      <Badge
        variant="secondary"
        className="gap-1 font-normal"
        aria-label={label}
      >
        <Icon className="size-3" aria-hidden />
        <span className="truncate">{label}</span>
      </Badge>
    </Hint>
  );
}
