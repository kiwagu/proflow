import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Badge } from '@workspace/ui/components/badge';
import { Separator } from '@workspace/ui/components/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip';
import { Lock } from 'lucide-react';

import type { ProjectionViewProps } from './view-registry';

/**
 * BoardProjectionView — status-segmented board (slice-06 §4.2). Renders
 * `result.items` SEGMENTED by `item.status` (e.g. draft / in_review / approved),
 * one column-block per status. This is the third vertical landing as PURE
 * configuration: a `board` view_types row + a `projections` row + a chosen
 * `requires_state` gating rule — same resolver, same registry, different values.
 *
 * Display gating, NOT access (ADR-0006 §2): every node the resolver returned
 * (RLS already narrowed it) is rendered. A node whose `nodeGates` verdict is
 * `available=false` is dimmed + carries a "not available" badge — it STAYS
 * visible (closure ≠ absence). An `available` node is actionable (its workflow
 * transitions render when `spaceId` is wired).
 *
 * Purely presentational: input is the already-resolved `ProjectionResult` + the
 * already-computed `GatingResult` (`nodeGates`) passed as a prop. It never
 * fetches and never calls a gating rule itself (ADR-0005 guardrail b).
 */

/** Stable status display order: draft → in_review → approved → everything else. */
const STATUS_ORDER = ['draft', 'in_review', 'approved'];

function statusRank(status: string): number {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? STATUS_ORDER.length : i;
}

/** Map a status to its i18n label key (neutral by mechanism). */
function statusLabelKey(status: string): string {
  switch (status) {
    case 'draft':
      return 'graph.board.statusDraft';
    case 'in_review':
      return 'graph.board.statusInReview';
    case 'approved':
      return 'graph.board.statusApproved';
    default:
      return 'graph.board.statusOther';
  }
}

export function BoardProjectionView({
  result,
  t,
  nodeGates,
}: ProjectionViewProps) {
  if (result.items.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        {t('graph.board.empty')}
      </p>
    );
  }

  // Index per-node gating verdicts by id so each item reads its own display state.
  const gateById = new Map((nodeGates?.nodes ?? []).map((n) => [n.id, n]));

  // Segment items by status, preserving the resolver's order within each segment.
  const segments = new Map<string, typeof result.items>();
  for (const item of result.items) {
    const bucket = segments.get(item.status) ?? [];
    bucket.push(item);
    segments.set(item.status, bucket);
  }
  const orderedStatuses = [...segments.keys()].sort(
    (a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b)
  );

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-8">
        {orderedStatuses.map((status) => {
          const items = segments.get(status) ?? [];
          return (
            <section key={status} className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <h2 className="font-heading text-lg">
                  {t(statusLabelKey(status))}
                </h2>
                <Badge variant="secondary" aria-hidden>
                  {items.length}
                </Badge>
                <Separator className="flex-1" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => {
                  const gate = gateById.get(item.id);
                  // No gating wired (defensive) ⇒ treat as available.
                  const available = gate?.available ?? true;
                  return (
                    <Card
                      key={item.id}
                      data-state={available ? 'available' : 'gated'}
                      className={available ? undefined : 'opacity-60'}
                    >
                      <CardHeader className="flex flex-row items-center gap-3">
                        <CardTitle className="flex-1">{item.title}</CardTitle>
                        {!available ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className="gap-1"
                                data-state="gated"
                              >
                                <Lock className="size-3" aria-hidden />
                                {t('graph.board.notAvailable')}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('graph.board.notAvailableHint')}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </CardHeader>
                      <CardContent className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{item.kind}</Badge>
                        <Badge variant="outline">
                          {t(statusLabelKey(item.status))}
                        </Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
