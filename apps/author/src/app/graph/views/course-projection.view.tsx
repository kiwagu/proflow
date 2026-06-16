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
 * CourseProjectionView — ordered vertical stepper (§3.2). Consumes
 * `result.items` IN ORDER (the resolver already materialized the prerequisite
 * sequence via the positions chain; this view never re-sorts). Each item is a
 * step; `depth`/`via_edge_id` give the traversal context the view reads.
 *
 * The lock indicator is a STATIC visual affordance: a step with `depth > 0`
 * (it has a prerequisite earlier in the chain) shows a lock. This is NOT
 * per-user gating — no user state is read; the lock is identical for everyone.
 * Real "locked until you pass the prerequisite" = per-user `resource_user_state`
 * and is DEFERRED (ADR-0004 §3/§5). Start nodes (`depth=0`, `via_edge_id=null`)
 * carry no lock — they are the entry point. Purely presentational.
 */
export function CourseProjectionView({ result, t }: ProjectionViewProps) {
  if (result.items.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        {t('graph.course.empty')}
      </p>
    );
  }

  return (
    <TooltipProvider>
      <ol className="flex flex-col gap-0">
        {result.items.map((item, index) => {
          const locked = item.depth > 0;
          const position = index + 1;
          return (
            <li key={item.id} className="flex flex-col gap-0">
              <Card>
                <CardHeader className="flex flex-row items-center gap-3">
                  <Badge variant="secondary" aria-hidden>
                    {position}
                  </Badge>
                  <CardTitle className="flex-1">{item.title}</CardTitle>
                  {locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="gap-1">
                          <Lock className="size-3" aria-hidden />
                          {t('graph.course.step', { position })}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('graph.course.locked')}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{item.kind}</Badge>
                  <Badge variant="outline">{item.status}</Badge>
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
