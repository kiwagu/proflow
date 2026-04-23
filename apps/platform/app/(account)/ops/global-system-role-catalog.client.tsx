'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

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
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Separator } from '@workspace/ui/components/separator';
import { useForm } from '@workspace/ui/components/tanstack-form';
import { Textarea } from '@workspace/ui/components/textarea';

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

type Translator = ReturnType<typeof getSpaceSettingsTranslator>;

function createRoleFormSchema(t: Translator) {
  return z.object({
    key: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, t('roleCatalog.validation.roleKeyTooShort'))
      .max(64, t('roleCatalog.validation.roleKeyTooLong'))
      .regex(/^[a-z][a-z0-9_]*$/, t('roleCatalog.validation.roleKeyFormat')),
    label: z
      .string()
      .trim()
      .min(1, t('roleCatalog.validation.roleLabelRequired'))
      .max(120),
    description: z.string().trim().max(400),
    permissionKeys: z
      .array(
        z.string().trim().min(1, t('roleCatalog.validation.permissionRequired'))
      )
      .min(1, t('roleCatalog.validation.permissionMinOne')),
  });
}

type RoleDraft = z.infer<ReturnType<typeof createRoleFormSchema>>;

type GlobalSystemRoleCatalogClientProps = Readonly<{
  roles: readonly PlatformRoleCatalogRow[];
  permissionCatalogKeys: readonly string[];
  locale: SpaceSettingsLocale;
}>;

function togglePermissionKey(
  permissionKeys: readonly string[],
  permissionKey: string,
  checked: boolean
): string[] {
  if (checked) {
    return [...new Set([...permissionKeys, permissionKey])];
  }
  return permissionKeys.filter((key) => key !== permissionKey);
}

type PermissionFieldProps = Readonly<{
  fieldIdPrefix: string;
  legend: string;
  description: string;
  permissionCatalogKeys: readonly string[];
  selectedPermissionKeys: readonly string[];
  onTogglePermission: (permissionKey: string, checked: boolean) => void;
}>;

function PermissionField({
  fieldIdPrefix,
  legend,
  description,
  permissionCatalogKeys,
  selectedPermissionKeys,
  onTogglePermission,
}: PermissionFieldProps) {
  const selectedPermissionKeySet = new Set(selectedPermissionKeys);

  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <div
        data-slot="checkbox-group"
        className="border-border bg-muted/30 flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-3"
      >
        {permissionCatalogKeys.map((permissionKey) => {
          const inputId = `${fieldIdPrefix}-${permissionKey}`;
          return (
            <Field key={permissionKey} orientation="horizontal">
              <Checkbox
                id={inputId}
                checked={selectedPermissionKeySet.has(permissionKey)}
                onCheckedChange={(value) =>
                  onTogglePermission(permissionKey, value === true)
                }
              />
              <FieldContent>
                <FieldLabel htmlFor={inputId}>{permissionKey}</FieldLabel>
              </FieldContent>
            </Field>
          );
        })}
      </div>
    </FieldSet>
  );
}

export function GlobalSystemRoleCatalogClient({
  roles,
  permissionCatalogKeys,
  locale,
}: GlobalSystemRoleCatalogClientProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const roleSchema = useMemo(() => createRoleFormSchema(t), [t]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [createPermissionKeys, setCreatePermissionKeys] = useState<string[]>(
    []
  );
  const [createConfirmed, setCreateConfirmed] = useState(false);
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

  const form = useForm({
    defaultValues: {
      key: '',
      label: '',
      description: '',
    },
    onSubmit: async ({ value }) => {
      setCatalogError(null);

      const parsedPayload = roleSchema.safeParse({
        ...value,
        permissionKeys: createPermissionKeys,
      });
      if (!parsedPayload.success) {
        setCatalogError(
          parsedPayload.error.issues[0]?.message ??
            t('roleCatalog.errors.invalidCreatePayload')
        );
        return;
      }

      const result = await createGlobalSystemRoleAction({
        key: parsedPayload.data.key,
        label: parsedPayload.data.label,
        description: parsedPayload.data.description,
        permissionKeys: parsedPayload.data.permissionKeys,
        confirmed: createConfirmed,
      });

      if (!result.ok) {
        setCatalogError(result.message);
        return;
      }

      form.reset({
        key: '',
        label: '',
        description: '',
      });
      setCreatePermissionKeys([]);
      setCreateConfirmed(false);
      router.refresh();
    },
  });

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="global-system-role-catalog"
    >
      <Card data-testid="global-system-role-catalog-create">
        <CardHeader>
          <CardTitle>{t('superAdmin.globalRoles.create.title')}</CardTitle>
          <CardDescription>
            {t('superAdmin.globalRoles.create.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <FieldGroup>
              <form.Field name="key">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      {t('roleCatalog.create.roleKeyLabel')}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value.toLowerCase())
                      }
                      placeholder={t('roleCatalog.create.roleKeyPlaceholder')}
                    />
                    <FieldDescription>
                      {t('superAdmin.globalRoles.create.keyHint')}
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>

              <form.Field name="label">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      {t('roleCatalog.create.roleLabelLabel')}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder={t('roleCatalog.create.roleLabelPlaceholder')}
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="description">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      {t('roleCatalog.create.descriptionLabel')}
                    </FieldLabel>
                    <Textarea
                      id={field.name}
                      rows={2}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder={t(
                        'superAdmin.globalRoles.create.descriptionPlaceholder'
                      )}
                    />
                  </Field>
                )}
              </form.Field>

              <Field data-invalid={createPermissionKeys.length === 0}>
                <PermissionField
                  fieldIdPrefix="create-global-role-permission"
                  legend={t('roleCatalog.permission.legend')}
                  description={t('roleCatalog.permission.description')}
                  permissionCatalogKeys={permissionCatalogKeys}
                  selectedPermissionKeys={createPermissionKeys}
                  onTogglePermission={(permissionKey, checked) => {
                    setCreatePermissionKeys((current) =>
                      togglePermissionKey(current, permissionKey, checked)
                    );
                  }}
                />
              </Field>

              <Field orientation="horizontal">
                <Checkbox
                  id="create-global-role-confirm"
                  checked={createConfirmed}
                  onCheckedChange={(value) =>
                    setCreateConfirmed(value === true)
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor="create-global-role-confirm">
                    {t('superAdmin.globalRoles.create.confirm')}
                  </FieldLabel>
                </FieldContent>
              </Field>
            </FieldGroup>

            {catalogError ? (
              <p className="text-destructive text-sm" role="alert">
                {catalogError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={!createConfirmed}>
                {t('superAdmin.globalRoles.create.submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
              {roles.map((role) => {
                const archiveConfirmed = archiveConfirmedRoleIds.has(role.id);
                return (
                  <Card key={role.id} size="sm">
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
                            <Badge variant="outline">
                              {t('roleCatalog.badge.archived')}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              {t('roleCatalog.badge.active')}
                            </Badge>
                          )}
                          {!role.archivedAt ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
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
                            >
                              {t('roleCatalog.actions.edit')}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      {role.description ? (
                        <p className="text-muted-foreground text-sm">
                          {role.description}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-1">
                        {role.permissionKeys.map((permissionKey) => (
                          <Badge
                            key={`${role.id}-${permissionKey}`}
                            variant="outline"
                          >
                            {permissionKey}
                          </Badge>
                        ))}
                      </div>

                      {!role.archivedAt ? (
                        <Field orientation="horizontal">
                          <Checkbox
                            id={`archive-global-role-confirm-${role.id}`}
                            checked={archiveConfirmed}
                            onCheckedChange={(value) => {
                              setArchiveConfirmedRoleIds((current) => {
                                const next = new Set(current);
                                if (value === true) {
                                  next.add(role.id);
                                } else {
                                  next.delete(role.id);
                                }
                                return next;
                              });
                            }}
                          />
                          <FieldContent>
                            <FieldLabel
                              htmlFor={`archive-global-role-confirm-${role.id}`}
                            >
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
                          disabled={
                            !archiveConfirmed || busyArchiveRoleId === role.id
                          }
                          onClick={() => {
                            void (async () => {
                              setCatalogError(null);
                              setBusyArchiveRoleId(role.id);
                              const result =
                                await archiveGlobalSystemRoleAction({
                                  roleId: role.id,
                                  confirmed: archiveConfirmed,
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
                        >
                          {t('roleCatalog.actions.archive')}
                        </Button>
                      ) : null}

                      <Collapsible open={editingRoleId === role.id}>
                        <CollapsibleContent className="flex flex-col gap-3">
                          <Separator />
                          {editingRoleId === role.id && editingDraft ? (
                            <div className="flex flex-col gap-3">
                              <FieldGroup>
                                <Field>
                                  <FieldLabel
                                    htmlFor={`edit-global-key-${role.id}`}
                                  >
                                    {t('roleCatalog.create.roleKeyLabel')}
                                  </FieldLabel>
                                  <Input
                                    id={`edit-global-key-${role.id}`}
                                    value={editingDraft.key}
                                    onChange={(event) =>
                                      setEditingDraft((current) =>
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
                                  <FieldLabel
                                    htmlFor={`edit-global-label-${role.id}`}
                                  >
                                    {t('roleCatalog.create.roleLabelLabel')}
                                  </FieldLabel>
                                  <Input
                                    id={`edit-global-label-${role.id}`}
                                    value={editingDraft.label}
                                    onChange={(event) =>
                                      setEditingDraft((current) =>
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
                                  <FieldLabel
                                    htmlFor={`edit-global-description-${role.id}`}
                                  >
                                    {t('roleCatalog.create.descriptionLabel')}
                                  </FieldLabel>
                                  <Textarea
                                    id={`edit-global-description-${role.id}`}
                                    rows={2}
                                    value={editingDraft.description}
                                    onChange={(event) =>
                                      setEditingDraft((current) =>
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
                                  description={t(
                                    'roleCatalog.permission.editDescription'
                                  )}
                                  permissionCatalogKeys={permissionCatalogKeys}
                                  selectedPermissionKeys={
                                    editingDraft.permissionKeys
                                  }
                                  onTogglePermission={(
                                    permissionKey,
                                    checked
                                  ) => {
                                    setEditingDraft((current) =>
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
                                      setEditingConfirmed(value === true)
                                    }
                                  />
                                  <FieldContent>
                                    <FieldLabel
                                      htmlFor={`edit-global-confirm-${role.id}`}
                                    >
                                      {t(
                                        'superAdmin.globalRoles.confirm.update'
                                      )}
                                    </FieldLabel>
                                  </FieldContent>
                                </Field>
                              </FieldGroup>

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={
                                    !editingConfirmed ||
                                    busyEditRoleId === role.id
                                  }
                                  onClick={() => {
                                    void (async () => {
                                      setCatalogError(null);
                                      const parsedDraft =
                                        roleSchema.safeParse(editingDraft);
                                      if (!parsedDraft.success) {
                                        setCatalogError(
                                          parsedDraft.error.issues[0]
                                            ?.message ??
                                            t(
                                              'roleCatalog.errors.invalidUpdatePayload'
                                            )
                                        );
                                        return;
                                      }

                                      setBusyEditRoleId(role.id);
                                      const result =
                                        await updateGlobalSystemRoleAction({
                                          roleId: role.id,
                                          key: parsedDraft.data.key,
                                          label: parsedDraft.data.label,
                                          description:
                                            parsedDraft.data.description,
                                          permissionKeys:
                                            parsedDraft.data.permissionKeys,
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
                                >
                                  {t('roleCatalog.actions.save')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingRoleId(null);
                                    setEditingDraft(null);
                                    setEditingConfirmed(false);
                                  }}
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
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {catalogError ? (
        <p className="text-destructive text-sm" role="alert">
          {catalogError}
        </p>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('roleCatalog.catalog.title')}</CardTitle>
          <CardDescription>
            {t('roleCatalog.catalog.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex max-h-56 flex-wrap gap-1 overflow-y-auto">
          {permissionCatalogKeys.map((permissionKey) => (
            <Badge key={`catalog-${permissionKey}`} variant="outline">
              {permissionKey}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
