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
import { Check, Lock } from 'lucide-react';

import { MarkCompleteButton } from './mark-complete-button';
import type { ProjectionViewProps } from './view-registry';

/**
 * CourseProjectionView — ordered vertical stepper (§3.2 / slice-05 §4.1).
 * Consumes `result.items` IN ORDER (the resolver already materialized the
 * prerequisite sequence; this view never re-sorts) and the per-step
 * `GatedSequence` computed server-side. Each item is a step; its display state
 * comes from the matching gated step.
 *
 * The lock is now DYNAMIC, driven by per-user progress (replacing the slice-04
 * static `depth > 0`). Per step:
 *  - unlocked & not done → a "mark complete" action (writes `done`, refreshes);
 *  - done → a "done" badge, no button;
 *  - locked → a lock + tooltip, no button (you cannot complete a closed step).
 *
 * Authorization ≠ gating (ADR-0004 §3): a locked step STILL renders (RLS let the
 * user read it — it is in `result.items`); the lock is computed display state,
 * not an access denial. The view stays purely presentational: gating arrives as
 * a prop; it never reads state or calls `gateSequence` itself.
 */
export function CourseProjectionView({
  result,
  t,
  gating,
  spaceId,
}: ProjectionViewProps) {
  if (result.items.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        {t('graph.course.empty')}
      </p>
    );
  }

  // Index gated steps by id so each item reads its own display state in order.
  const gatedById = new Map((gating?.steps ?? []).map((s) => [s.id, s]));

  return (
    <TooltipProvider>
      <ol className="flex flex-col gap-0">
        {result.items.map((item, index) => {
          const step = gatedById.get(item.id);
          // No gating wired (defensive) ⇒ treat as unlocked, not-started.
          const locked = step?.locked ?? false;
          const done = step?.coarse_status === 'done';
          const position = index + 1;
          return (
            <li key={item.id} className="flex flex-col gap-0">
              <Card>
                <CardHeader className="flex flex-row items-center gap-3">
                  <Badge variant="secondary" aria-hidden>
                    {position}
                  </Badge>
                  <CardTitle className="flex-1">{item.title}</CardTitle>
                  {done ? (
                    <Badge className="gap-1">
                      <Check className="size-3" aria-hidden />
                      {t('graph.course.done')}
                    </Badge>
                  ) : null}
                  {locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="gap-1"
                          data-state="locked"
                        >
                          <Lock className="size-3" aria-hidden />
                          {t('graph.course.step', { position })}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('graph.course.lockedByPrereq')}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{item.kind}</Badge>
                  <Badge variant="outline">{item.status}</Badge>
                  {/* Mark-complete only on an unlocked, not-yet-done step. A
                      locked step has no button (UI gate); a done step shows the
                      badge above instead. */}
                  {!locked && !done && spaceId ? (
                    <MarkCompleteButton
                      spaceId={spaceId}
                      resourceId={item.id}
                      label={t('graph.course.markComplete')}
                      pendingLabel={t('graph.course.marking')}
                      errorLabel={t('graph.course.markError')}
                    />
                  ) : null}
                </CardContent>
              </Card>
              {index < result.items.length - 1 ? (
                <div className="flex justify-center py-2">
                  <Separator orientation="vertical" className="h-6" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </TooltipProvider>
  );
}
