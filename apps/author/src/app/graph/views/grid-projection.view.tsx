import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Badge } from '@workspace/ui/components/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip';
import { FileText } from 'lucide-react';

import type { ProjectionViewProps } from './view-registry';

/**
 * GridProjectionView — knowledge-base card grid (§3.1). Renders
 * `result.items` FLAT (the KB spec produces a non-hierarchical set). Each item
 * is a card: title + kind/status badges + a "has body" indicator when
 * `body_ref != null`. The body itself is NOT expanded in this slice (ADR-0002).
 *
 * Purely presentational: input is the already-resolved (RLS-narrowed) result +
 * a translator. An empty set renders the empty-state — which is exactly what a
 * user without `space.knowledge.read` sees (RLS returned nothing, §7).
 */
export function GridProjectionView({ result, t }: ProjectionViewProps) {
  if (result.items.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        {t('graph.grid.empty')}
      </p>
    );
  }

  return (
    <TooltipProvider>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{item.kind}</Badge>
              <Badge variant="outline">{item.status}</Badge>
              {item.body_ref != null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1">
                      <FileText className="size-3" aria-hidden />
                      {t('graph.body.present')}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{t('graph.grid.bodyPresent')}</TooltipContent>
                </Tooltip>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </TooltipProvider>
  );
}
