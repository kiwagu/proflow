import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import type { ProjectionViewProps } from '@/app/graph/views/registry';

/**
 * UnknownProjectionView — graceful fallback (§2.3). Reached when the resolved
 * `view` key has no registered component yet (the data carries a view whose
 * renderer has not landed). Renders an explicit "not supported" panel instead of
 * crashing — proving a new view is purely additive and an unknown one is safe.
 */
export function UnknownProjectionView({ messages }: ProjectionViewProps) {
  const t = createGraphTranslator(messages);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('graph.view.unsupported')}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        {t('graph.view.unsupported')}
      </CardContent>
    </Card>
  );
}
