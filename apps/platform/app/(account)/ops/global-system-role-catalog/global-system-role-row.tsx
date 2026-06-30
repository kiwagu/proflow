import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Collapsible,
  CollapsibleContent,
} from '@workspace/ui/components/collapsible';
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Separator } from '@workspace/ui/components/separator';
import { Textarea } from '@workspace/ui/components/textarea';

import type { PlatformRoleCatalogRow } from '@/lib/platform-role-catalog.actions';

import type {
  RoleDraft,
  Translator,
} from './global-system-role-catalog.schema';
import {
  PermissionField,
  togglePermissionKey,
} from './global-system-role-permission-field';

type GlobalSystemRoleRowProps = Readonly<{
  role: PlatformRoleCatalogRow;
  t: Translator;
  permissionCatalogKeys: readonly string[];
  archiveConfirmed: boolean;
  busyArchive: boolean;
  busyEdit: boolean;
  isEditing: boolean;
  editingDraft: RoleDraft | null;
  editingConfirmed: boolean;
  onArchiveConfirmChange: (checked: boolean) => void;
  onArchive: () => void;
  onBeginEdit: () => void;
  onEditingDraftChange: (
    update: (current: RoleDraft | null) => RoleDraft | null
  ) => void;
  onEditingConfirmChange: (checked: boolean) => void;
  onSave: () => void;
  onCancelEdit: () => void;
}>;

export function GlobalSystemRoleRow({
  role,
  t,
  permissionCatalogKeys,
  archiveConfirmed,
  busyArchive,
  busyEdit,
  isEditing,
  editingDraft,
  editingConfirmed,
  onArchiveConfirmChange,
  onArchive,
  onBeginEdit,
  onEditingDraftChange,
  onEditingConfirmChange,
  onSave,
  onCancelEdit,
}: GlobalSystemRoleRowProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>{role.label}</CardTitle>
            <CardDescription>
              {role.key} · {t('roleCatalog.scope.global')}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {role.archivedAt ? (
              <Badge variant="outline">{t('roleCatalog.badge.archived')}</Badge>
            ) : (
              <Badge variant="secondary">{t('roleCatalog.badge.active')}</Badge>
            )}
            {!role.archivedAt ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onBeginEdit}
              >
                {t('roleCatalog.actions.edit')}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {role.description ? (
          <p className="text-muted-foreground text-sm">{role.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {role.permissionKeys.map((permissionKey) => (
            <Badge key={`${role.id}-${permissionKey}`} variant="outline">
              {permissionKey}
            </Badge>
          ))}
        </div>

        {!role.archivedAt ? (
          <Field orientation="horizontal">
            <Checkbox
              id={`archive-global-role-confirm-${role.id}`}
              checked={archiveConfirmed}
              onCheckedChange={(value) =>
                onArchiveConfirmChange(value === true)
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={`archive-global-role-confirm-${role.id}`}>
                {t('superAdmin.globalRoles.confirm.archive')}
              </FieldLabel>
            </FieldContent>
          </Field>
        ) : null}

        {!role.archivedAt ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!archiveConfirmed || busyArchive}
            onClick={onArchive}
          >
            {t('roleCatalog.actions.archive')}
          </Button>
        ) : null}

        <Collapsible open={isEditing}>
          <CollapsibleContent className="flex flex-col gap-3">
            <Separator />
            {isEditing && editingDraft ? (
              <div className="flex flex-col gap-3">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`edit-global-key-${role.id}`}>
                      {t('roleCatalog.create.roleKeyLabel')}
                    </FieldLabel>
                    <Input
                      id={`edit-global-key-${role.id}`}
                      value={editingDraft.key}
                      onChange={(event) =>
                        onEditingDraftChange((current) =>
                          current
                            ? {
                                ...current,
                                key: event.target.value.toLowerCase(),
                              }
                            : current
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`edit-global-label-${role.id}`}>
                      {t('roleCatalog.create.roleLabelLabel')}
                    </FieldLabel>
                    <Input
                      id={`edit-global-label-${role.id}`}
                      value={editingDraft.label}
                      onChange={(event) =>
                        onEditingDraftChange((current) =>
                          current
                            ? {
                                ...current,
                                label: event.target.value,
                              }
                            : current
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`edit-global-description-${role.id}`}>
                      {t('roleCatalog.create.descriptionLabel')}
                    </FieldLabel>
                    <Textarea
                      id={`edit-global-description-${role.id}`}
                      rows={2}
                      value={editingDraft.description}
                      onChange={(event) =>
                        onEditingDraftChange((current) =>
                          current
                            ? {
                                ...current,
                                description: event.target.value,
                              }
                            : current
                        )
                      }
                    />
                  </Field>

                  <PermissionField
                    fieldIdPrefix={`edit-global-role-permission-${role.id}`}
                    legend={t('roleCatalog.permission.legend')}
                    description={t('roleCatalog.permission.editDescription')}
                    permissionCatalogKeys={permissionCatalogKeys}
                    selectedPermissionKeys={editingDraft.permissionKeys}
                    onTogglePermission={(permissionKey, checked) => {
                      onEditingDraftChange((current) =>
                        current
                          ? {
                              ...current,
                              permissionKeys: togglePermissionKey(
                                current.permissionKeys,
                                permissionKey,
                                checked
                              ),
                            }
                          : current
                      );
                    }}
                  />

                  <Field orientation="horizontal">
                    <Checkbox
                      id={`edit-global-confirm-${role.id}`}
                      checked={editingConfirmed}
                      onCheckedChange={(value) =>
                        onEditingConfirmChange(value === true)
                      }
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`edit-global-confirm-${role.id}`}>
                        {t('superAdmin.globalRoles.confirm.update')}
                      </FieldLabel>
                    </FieldContent>
                  </Field>
                </FieldGroup>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!editingConfirmed || busyEdit}
                    onClick={onSave}
                  >
                    {t('roleCatalog.actions.save')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onCancelEdit}
                  >
                    {t('roleCatalog.actions.cancel')}
                  </Button>
                </div>
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
