'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { FieldError } from '@workspace/ui/components/field';

import {
  archiveOrganizationCustomRoleAction,
  createOrganizationCustomRoleAction,
  type PlatformRoleCatalogRow,
  updateOrganizationCustomRoleAction,
} from '@/lib/platform-role-catalog.actions';
import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';
import {
  createRoleFormSchema,
  PermissionCatalogCard,
  type RoleDraft,
  RoleCreateForm,
  RoleRow,
  type Translator,
} from '@/components/role-catalog';

type OrganizationRoleCatalogClientProps = Readonly<{
  organizationId: string;
  roles: readonly PlatformRoleCatalogRow[];
  permissionCatalogKeys: readonly string[];
  locale: SpaceSettingsLocale;
}>;

function formatRoleScope(scope: string, t: Translator): string {
  if (scope === 'organization') {
    return t('roleCatalog.scope.organization');
  }
  if (scope === 'space') {
    return t('roleCatalog.scope.space');
  }
  return scope;
}

export function OrganizationRoleCatalogClient({
  organizationId,
  roles,
  permissionCatalogKeys,
  locale,
}: OrganizationRoleCatalogClientProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const roleSchema = useMemo(() => createRoleFormSchema(t), [t]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busyArchiveRoleId, setBusyArchiveRoleId] = useState<string | null>(
    null
  );
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<RoleDraft | null>(null);
  const [busyEditRoleId, setBusyEditRoleId] = useState<string | null>(null);

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={`organization-role-catalog-${organizationId}`}
    >
      <RoleCreateForm
        t={t}
        roleSchema={roleSchema}
        permissionCatalogKeys={permissionCatalogKeys}
        catalogError={catalogError}
        onError={setCatalogError}
        onCreated={() => router.refresh()}
        copy={{
          cardTitle: t('roleCatalog.create.title'),
          cardDescription: t('roleCatalog.create.description'),
          keyHint: t('roleCatalog.create.roleKeyHint'),
          descriptionPlaceholder: t(
            'roleCatalog.create.descriptionPlaceholder'
          ),
          submitLabel: t('roleCatalog.actions.create'),
        }}
        fieldIdPrefix="create-role-permission"
        cardTestId="organization-role-catalog-create"
        formTestId="organization-role-catalog-create-form"
        showFieldErrors
        onSubmit={(payload) =>
          createOrganizationCustomRoleAction({
            organizationId,
            key: payload.key,
            label: payload.label,
            description: payload.description,
            permissionKeys: payload.permissionKeys,
            scope: 'space',
          })
        }
      />

      <Card data-testid="organization-role-catalog-list">
        <CardHeader>
          <CardTitle>{t('roleCatalog.list.title')}</CardTitle>
          <CardDescription>{t('roleCatalog.list.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('roleCatalog.list.empty')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {roles.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  t={t}
                  permissionCatalogKeys={permissionCatalogKeys}
                  scopeLabel={formatRoleScope(role.scope, t)}
                  editIdPrefix="edit"
                  permissionFieldIdPrefix="edit-role-permission"
                  rowTestId={`organization-role-row-${role.id}`}
                  saveTestId={`organization-role-save-${role.id}`}
                  busyArchive={busyArchiveRoleId === role.id}
                  busyEdit={busyEditRoleId === role.id}
                  isEditing={editingRoleId === role.id}
                  editingDraft={editingRoleId === role.id ? editingDraft : null}
                  onArchive={() => {
                    void (async () => {
                      setCatalogError(null);
                      setBusyArchiveRoleId(role.id);
                      const result = await archiveOrganizationCustomRoleAction({
                        roleId: role.id,
                      });
                      setBusyArchiveRoleId(null);
                      if (!result.ok) {
                        setCatalogError(result.message);
                        return;
                      }
                      router.refresh();
                    })();
                  }}
                  onBeginEdit={() => {
                    setCatalogError(null);
                    setEditingRoleId(role.id);
                    setEditingDraft({
                      key: role.key,
                      label: role.label,
                      description: role.description ?? '',
                      permissionKeys: [...role.permissionKeys],
                    });
                  }}
                  onEditingDraftChange={setEditingDraft}
                  onSave={() => {
                    void (async () => {
                      setCatalogError(null);
                      const parsedDraft = roleSchema.safeParse(editingDraft);
                      if (!parsedDraft.success) {
                        setCatalogError(
                          parsedDraft.error.issues[0]?.message ??
                            t('roleCatalog.errors.invalidUpdatePayload')
                        );
                        return;
                      }

                      setBusyEditRoleId(role.id);
                      const result = await updateOrganizationCustomRoleAction({
                        roleId: role.id,
                        key: parsedDraft.data.key,
                        label: parsedDraft.data.label,
                        description: parsedDraft.data.description,
                        permissionKeys: parsedDraft.data.permissionKeys,
                      });
                      setBusyEditRoleId(null);

                      if (!result.ok) {
                        setCatalogError(result.message);
                        return;
                      }

                      setEditingRoleId(null);
                      setEditingDraft(null);
                      router.refresh();
                    })();
                  }}
                  onCancelEdit={() => {
                    setEditingRoleId(null);
                    setEditingDraft(null);
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {catalogError ? (
        <FieldError className="text-destructive text-sm">
          {catalogError}
        </FieldError>
      ) : null}

      <PermissionCatalogCard
        t={t}
        permissionCatalogKeys={permissionCatalogKeys}
      />
    </div>
  );
}
