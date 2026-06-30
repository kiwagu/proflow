import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { OrganizationRoleCatalogClient } from '@/app/(account)/space-settings/organization-role-catalog';
import type { SpaceSettingsLocale } from '@/app/(account)/space-settings/space-settings.i18n';
import type { SpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.helpers';
import type { PlatformRoleCatalogRow } from '@/lib/platform-role-catalog.actions';

export function SpaceOrgRolesSection({
  organizationId,
  roles,
  permissionCatalogKeys,
  locale,
  errorMessage,
  t,
}: {
  organizationId: string;
  roles: PlatformRoleCatalogRow[];
  permissionCatalogKeys: string[];
  locale: SpaceSettingsLocale;
  errorMessage: string | null;
  t: SpaceSettingsTranslator;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('spaceSettings.orgRoles.title')}</CardTitle>
        <CardDescription>
          {t('spaceSettings.orgRoles.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {errorMessage ? (
          <p className="text-destructive text-sm" role="alert">
            {errorMessage}
          </p>
        ) : (
          <OrganizationRoleCatalogClient
            organizationId={organizationId}
            roles={roles}
            permissionCatalogKeys={permissionCatalogKeys}
            locale={locale}
          />
        )}
      </CardContent>
    </Card>
  );
}
