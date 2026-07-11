import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { OrganizationAvatarForm } from '@/app/(account)/organizations/[organizationId]/settings/organization-avatar-form';
import type { OrganizationSettingsTranslator } from '@/app/(account)/organizations/[organizationId]/settings/organization-settings.helpers';

export function OrganizationAvatarSection({
  organizationId,
  organizationName,
  organizationSlug,
  avatarUrl,
  t,
}: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  avatarUrl: string | null;
  t: OrganizationSettingsTranslator;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{organizationName}</CardTitle>
        <CardDescription>
          {t('organizations.slug', { slug: organizationSlug })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">
              {t('organizationSettings.avatar.title')}
            </p>
            <p className="text-muted-foreground text-sm">
              {t('organizationSettings.avatar.description')}
            </p>
          </div>
          <OrganizationAvatarForm
            organizationId={organizationId}
            currentValue={avatarUrl}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
          />
        </div>
      </CardContent>
    </Card>
  );
}
