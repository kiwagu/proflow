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

import {
  archiveGlobalSystemRoleAction,
  updateGlobalSystemRoleAction,
} from '@/lib/platform-role-catalog.actions';
import { getSpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.i18n';

import {
  createRoleFormSchema,
  type GlobalSystemRoleCatalogClientProps,
  type RoleDraft,
} from './global-system-role-catalog.schema';
import { GlobalSystemRoleCreateForm } from './global-system-role-create-form';
import { GlobalSystemRoleRow } from './global-system-role-row';
import { PermissionCatalogCard } from './permission-catalog-card';

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
      <GlobalSystemRoleCreateForm
        t={t}
        roleSchema={roleSchema}
        permissionCatalogKeys={permissionCatalogKeys}
        catalogError={catalogError}
        onError={setCatalogError}
        onCreated={() => router.refresh()}
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
                <GlobalSystemRoleRow
                  key={role.id}
                  role={role}
                  t={t}
                  permissionCatalogKeys={permissionCatalogKeys}
                  archiveConfirmed={archiveConfirmedRoleIds.has(role.id)}
                  busyArchive={busyArchiveRoleId === role.id}
                  busyEdit={busyEditRoleId === role.id}
                  isEditing={editingRoleId === role.id}
                  editingDraft={editingRoleId === role.id ? editingDraft : null}
                  editingConfirmed={editingConfirmed}
                  onArchiveConfirmChange={(checked) => {
                    setArchiveConfirmedRoleIds((current) => {
                      const next = new Set(current);
                      if (checked) {
                        next.add(role.id);
                      } else {
                        next.delete(role.id);
                      }
                      return next;
                    });
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
                  onEditingConfirmChange={(checked) =>
                    setEditingConfirmed(checked)
                  }
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
        <p className="text-destructive text-sm" role="alert">
          {catalogError}
        </p>
      ) : null}

      <PermissionCatalogCard
        t={t}
        permissionCatalogKeys={permissionCatalogKeys}
      />
    </div>
  );
}
