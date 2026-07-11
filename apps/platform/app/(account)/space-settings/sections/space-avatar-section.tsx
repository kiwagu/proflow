import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { SpaceAvatarForm } from '@/app/(account)/space-settings/space-avatar-form';
import type { SpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.helpers';

export function SpaceAvatarSection({
  spaceId,
  spaceName,
  spaceSlug,
  avatarUrl,
  t,
}: {
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  avatarUrl: string | null;
  t: SpaceSettingsTranslator;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{spaceName}</CardTitle>
        <CardDescription>
          {t('spaceSettings.slug', { slug: spaceSlug })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">
              {t('spaceSettings.avatar.title')}
            </p>
            <p className="text-muted-foreground text-sm">
              {t('spaceSettings.avatar.description')}
            </p>
          </div>
          <SpaceAvatarForm
            spaceId={spaceId}
            currentValue={avatarUrl}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
          />
        </div>
      </CardContent>
    </Card>
  );
}
