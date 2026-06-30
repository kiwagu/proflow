import { Badge } from '@workspace/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import type { Translator } from './global-system-role-catalog.schema';

type PermissionCatalogCardProps = Readonly<{
  t: Translator;
  permissionCatalogKeys: readonly string[];
}>;

export function PermissionCatalogCard({
  t,
  permissionCatalogKeys,
}: PermissionCatalogCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('roleCatalog.catalog.title')}</CardTitle>
        <CardDescription>
          {t('roleCatalog.catalog.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex max-h-56 flex-wrap gap-1 overflow-y-auto">
        {permissionCatalogKeys.map((permissionKey) => (
          <Badge key={`catalog-${permissionKey}`} variant="outline">
            {permissionKey}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
