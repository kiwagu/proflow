'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Field, FieldLabel } from '@workspace/ui/components/field';
import { cn } from '@workspace/ui/lib/utils';

import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';
import {
  setSpaceMemberRoleAction,
  type SpaceMemberRoleAssignmentRow,
  type SpaceMemberRoleOption,
} from '@/lib/space-member-role.actions';

const selectClassName = cn(
  'border-input bg-background ring-offset-background',
  'focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs',
  'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50'
);

type SpaceMemberRolesClientProps = Readonly<{
  spaceId: string;
  locale: SpaceSettingsLocale;
  roleOptions: readonly SpaceMemberRoleOption[];
  members: readonly SpaceMemberRoleAssignmentRow[];
}>;

export function SpaceMemberRolesClient({
  spaceId,
  locale,
  roleOptions,
  members,
}: SpaceMemberRolesClientProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoleByUserId, setSelectedRoleByUserId] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      members.map((member) => [member.userId, member.selectedRoleKey])
    )
  );

  if (members.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t('memberRoles.empty')}</p>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`space-member-roles-${spaceId}`}
    >
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {members.map((member) => {
        const selectedRoleKey =
          selectedRoleByUserId[member.userId] ?? member.selectedRoleKey;
        const hasChanged = selectedRoleKey !== member.selectedRoleKey;
        const label =
          member.displayName ??
          member.email ??
          t('memberRoles.memberFallback', { userId: member.userId });

        return (
          <Card
            key={member.userId}
            size="sm"
            data-testid={`space-member-role-row-${member.userId}`}
          >
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              <CardDescription>{member.email ?? member.userId}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs font-medium uppercase">
                  {t('memberRoles.currentRoles')}
                </p>
                {member.assignedRoles.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {member.assignedRoles.map((role) => (
                      <Badge
                        key={`${member.userId}-${role.key}`}
                        variant="outline"
                      >
                        {role.label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t('memberRoles.noneAssigned')}
                  </p>
                )}
              </div>

              <Field>
                <FieldLabel htmlFor={`member-role-${member.userId}`}>
                  {t('memberRoles.roleLabel')}
                </FieldLabel>
                <select
                  id={`member-role-${member.userId}`}
                  data-testid={`space-member-role-select-${member.userId}`}
                  className={selectClassName}
                  value={selectedRoleKey}
                  onChange={(event) => {
                    const nextRoleKey = event.target.value;
                    setSelectedRoleByUserId((current) => ({
                      ...current,
                      [member.userId]: nextRoleKey,
                    }));
                  }}
                  disabled={busyUserId === member.userId}
                >
                  {roleOptions.map((role) => (
                    <option
                      key={`${member.userId}-${role.key}`}
                      value={role.key}
                    >
                      {role.label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid={`space-member-role-save-${member.userId}`}
                  disabled={!hasChanged || busyUserId === member.userId}
                  onClick={() => {
                    void (async () => {
                      setError(null);
                      setBusyUserId(member.userId);
                      const result = await setSpaceMemberRoleAction({
                        spaceId,
                        targetUserId: member.userId,
                        roleKey: selectedRoleKey,
                      });
                      setBusyUserId(null);

                      if (!result.ok) {
                        setError(result.message);
                        return;
                      }

                      router.refresh();
                    })();
                  }}
                >
                  {t('memberRoles.actions.save')}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
