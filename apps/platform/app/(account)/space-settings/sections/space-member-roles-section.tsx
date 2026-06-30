import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { FieldError } from '@workspace/ui/components/field';

import { SpaceMemberRolesClient } from '@/app/(account)/space-settings/space-member-roles.client';
import type { SpaceSettingsLocale } from '@/app/(account)/space-settings/space-settings.i18n';
import type { SpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.helpers';
import type { SpaceMemberRoleAssignmentRow } from '@/lib/space-member-role.actions';
import type { listInvitableSpaceRolesForUser } from '@/lib/platform-role-catalog';

type RoleOptions = Awaited<ReturnType<typeof listInvitableSpaceRolesForUser>>;

export function SpaceMemberRolesSection({
  spaceId,
  locale,
  roleOptions,
  members,
  errorMessage,
  t,
}: {
  spaceId: string;
  locale: SpaceSettingsLocale;
  roleOptions: RoleOptions;
  members: SpaceMemberRoleAssignmentRow[];
  errorMessage: string | null;
  t: SpaceSettingsTranslator;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('spaceSettings.memberRoles.title')}</CardTitle>
        <CardDescription>
          {t('spaceSettings.memberRoles.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {errorMessage ? (
          <FieldError className="text-destructive text-sm">
            {errorMessage}
          </FieldError>
        ) : (
          <SpaceMemberRolesClient
            spaceId={spaceId}
            locale={locale}
            roleOptions={roleOptions}
            members={members}
          />
        )}
      </CardContent>
    </Card>
  );
}
