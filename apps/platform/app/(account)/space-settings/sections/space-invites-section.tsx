import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { SpaceInviteManagerClient } from '@/app/(account)/organizations/space-invite.manager.client';
import type { SpaceSettingsLocale } from '@/app/(account)/space-settings/space-settings.i18n';
import type { SpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.helpers';
import type { listInvitableSpaceRolesForUser } from '@/lib/platform-role-catalog';

type InvitableRoles = Awaited<
  ReturnType<typeof listInvitableSpaceRolesForUser>
>;

type PendingInvite = {
  id: string;
  email: string;
  roleKey: string;
  roleLabel: string;
  expiresAt: string;
  token: string;
};

export function SpaceInvitesSection({
  spaceId,
  spaceName,
  spaceSlug,
  locale,
  invitableRoles,
  pendingInvites,
  t,
}: {
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  locale: SpaceSettingsLocale;
  invitableRoles: InvitableRoles;
  pendingInvites: PendingInvite[];
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
        <SpaceInviteManagerClient
          spaceId={spaceId}
          spaceName={spaceName}
          spaceSlug={spaceSlug}
          locale={locale}
          invitableRoles={invitableRoles}
          pendingInvites={pendingInvites}
        />
      </CardContent>
    </Card>
  );
}
