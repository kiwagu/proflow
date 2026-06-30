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
  archiveGlobalSystemRoleAction,
  createGlobalSystemRoleAction,
  type PlatformRoleCatalogRow,
  updateGlobalSystemRoleAction,
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
} from '@/components/role-catalog';

type GlobalSystemRoleCatalogClientProps = Readonly<{
  roles: readonly PlatformRoleCatalogRow[];
  permissionCatalogKeys: readonly string[];
  locale: SpaceSettingsLocale;
}>;

export function GlobalSystemRoleCatalogClient({
  roles,
  permissionCatalogKeys,
  locale,
}: GlobalSystemRoleCatalogClientProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const roleSchema = useMemo(() => createRoleFormSchema(t), [t]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busyArchiveRoleId, setBusyArchiveRoleId] = useState<string | null>(
    null
  );
  const [archiveConfirmedRoleIds, setArchiveConfirmedRoleIds] = useState<
    Set<string>
  >(new Set());
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<RoleDraft | null>(null);
  const [editingConfirmed, setEditingConfirmed] = useState(false);
  const [busyEditRoleId, setBusyEditRoleId] = useState<string | null>(null);

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="global-system-role-catalog"
    >
      <RoleCreateForm
        t={t}
        roleSchema={roleSchema}
        permissionCatalogKeys={permissionCatalogKeys}
        catalogError={catalogError}
        onError={setCatalogError}
        onCreated={() => router.refresh()}
        copy={{
          cardTitle: t('superAdmin.globalRoles.create.title'),
          cardDescription: t('superAdmin.globalRoles.create.description'),
          keyHint: t('superAdmin.globalRoles.create.keyHint'),
          descriptionPlaceholder: t(
            'superAdmin.globalRoles.create.descriptionPlaceholder'
          ),
          submitLabel: t('superAdmin.globalRoles.create.submit'),
        }}
        fieldIdPrefix="create-global-role-permission"
        cardTestId="global-system-role-catalog-create"
        confirm={{
          inputId: 'create-global-role-confirm',
          label: t('superAdmin.globalRoles.create.confirm'),
        }}
        onSubmit={(payload) =>
          createGlobalSystemRoleAction({
            key: payload.key,
            label: payload.label,
            description: payload.description,
            permissionKeys: payload.permissionKeys,
            confirmed: payload.confirmed,
          })
        }
      />

      <Card data-testid="global-system-role-catalog-list">
        <CardHeader>
          <CardTitle>{t('superAdmin.globalRoles.list.title')}</CardTitle>
          <CardDescription>
            {t('superAdmin.globalRoles.list.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('superAdmin.globalRoles.list.empty')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {roles.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  t={t}
                  permissionCatalogKeys={permissionCatalogKeys}
                  scopeLabel={t('roleCatalog.scope.global')}
                  editIdPrefix="edit-global"
                  permissionFieldIdPrefix="edit-global-role-permission"
                  busyArchive={busyArchiveRoleId === role.id}
                  busyEdit={busyEditRoleId === role.id}
                  isEditing={editingRoleId === role.id}
                  editingDraft={editingRoleId === role.id ? editingDraft : null}
                  confirmArchive={{
                    inputId: `archive-global-role-confirm-${role.id}`,
                    label: t('superAdmin.globalRoles.confirm.archive'),
                    checked: archiveConfirmedRoleIds.has(role.id),
                    onChange: (checked) => {
                      setArchiveConfirmedRoleIds((current) => {
                        const next = new Set(current);
                        if (checked) {
                          next.add(role.id);
                        } else {
                          next.delete(role.id);
                        }
                        return next;
                      });
                    },
                  }}
                  confirmEdit={{
                    inputId: `edit-global-confirm-${role.id}`,
                    label: t('superAdmin.globalRoles.confirm.update'),
                    checked: editingConfirmed,
                    onChange: (checked) => setEditingConfirmed(checked),
                  }}
                  onArchive={() => {
                    void (async () => {
                      setCatalogError(null);
                      setBusyArchiveRoleId(role.id);
                      const result = await archiveGlobalSystemRoleAction({
                        roleId: role.id,
                        confirmed: archiveConfirmedRoleIds.has(role.id),
                      });
                      setBusyArchiveRoleId(null);
                      if (!result.ok) {
                        setCatalogError(result.message);
                        return;
                      }
                      setArchiveConfirmedRoleIds((current) => {
                        const next = new Set(current);
                        next.delete(role.id);
                        return next;
                      });
                      router.refresh();
                    })();
                  }}
                  onBeginEdit={() => {
                    setCatalogError(null);
                    setEditingRoleId(role.id);
                    setEditingConfirmed(false);
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
                      const result = await updateGlobalSystemRoleAction({
                        roleId: role.id,
                        key: parsedDraft.data.key,
                        label: parsedDraft.data.label,
                        description: parsedDraft.data.description,
                        permissionKeys: parsedDraft.data.permissionKeys,
                        confirmed: editingConfirmed,
                      });
                      setBusyEditRoleId(null);

                      if (!result.ok) {
                        setCatalogError(result.message);
                        return;
                      }

                      setEditingRoleId(null);
                      setEditingDraft(null);
                      setEditingConfirmed(false);
                      router.refresh();
                    })();
                  }}
                  onCancelEdit={() => {
                    setEditingRoleId(null);
                    setEditingDraft(null);
                    setEditingConfirmed(false);
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
