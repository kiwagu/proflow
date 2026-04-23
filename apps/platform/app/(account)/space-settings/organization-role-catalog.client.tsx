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
  FieldError,
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
  archiveOrganizationCustomRoleAction,
  createOrganizationCustomRoleAction,
  type PlatformRoleCatalogRow,
  updateOrganizationCustomRoleAction,
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

function createUpdateRoleDraftSchema(t: Translator) {
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

type UpdateRoleDraft = z.infer<ReturnType<typeof createUpdateRoleDraftSchema>>;

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

export function OrganizationRoleCatalogClient({
  organizationId,
  roles,
  permissionCatalogKeys,
  locale,
}: OrganizationRoleCatalogClientProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const roleCreateSchema = useMemo(() => createRoleFormSchema(t), [t]);
  const roleUpdateSchema = useMemo(() => createUpdateRoleDraftSchema(t), [t]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busyArchiveRoleId, setBusyArchiveRoleId] = useState<string | null>(
    null
  );
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<UpdateRoleDraft | null>(
    null
  );
  const [createPermissionKeys, setCreatePermissionKeys] = useState<string[]>(
    []
  );
  const [busyEditRoleId, setBusyEditRoleId] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      key: '',
      label: '',
      description: '',
    },
    onSubmit: async ({ value }) => {
      setCatalogError(null);

      const parsedPayload = roleCreateSchema.safeParse({
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

      const result = await createOrganizationCustomRoleAction({
        organizationId,
        key: parsedPayload.data.key,
        label: parsedPayload.data.label,
        description: parsedPayload.data.description,
        permissionKeys: parsedPayload.data.permissionKeys,
        scope: 'space',
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
      router.refresh();
    },
  });

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={`organization-role-catalog-${organizationId}`}
    >
      <Card data-testid="organization-role-catalog-create">
        <CardHeader>
          <CardTitle>{t('roleCatalog.create.title')}</CardTitle>
          <CardDescription>
            {t('roleCatalog.create.description')}
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
            data-testid="organization-role-catalog-create-form"
          >
            <FieldGroup>
              <form.Field name="key">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>
                        {t('roleCatalog.create.roleKeyLabel')}
                      </FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value.toLowerCase())
                        }
                        placeholder={t('roleCatalog.create.roleKeyPlaceholder')}
                        aria-invalid={isInvalid}
                      />
                      {isInvalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : (
                        <FieldDescription>
                          {t('roleCatalog.create.roleKeyHint')}
                        </FieldDescription>
                      )}
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field name="label">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>
                        {t('roleCatalog.create.roleLabelLabel')}
                      </FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder={t(
                          'roleCatalog.create.roleLabelPlaceholder'
                        )}
                        aria-invalid={isInvalid}
                      />
                      {isInvalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field name="description">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>
                        {t('roleCatalog.create.descriptionLabel')}
                      </FieldLabel>
                      <Textarea
                        id={field.name}
                        name={field.name}
                        rows={2}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder={t(
                          'roleCatalog.create.descriptionPlaceholder'
                        )}
                        aria-invalid={isInvalid}
                      />
                      {isInvalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  );
                }}
              </form.Field>

              <Field data-invalid={createPermissionKeys.length === 0}>
                <PermissionField
                  fieldIdPrefix="create-role-permission"
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
            </FieldGroup>

            {catalogError ? (
              <p className="text-destructive text-sm" role="alert">
                {catalogError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm">
                {t('roleCatalog.actions.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
                <Card
                  key={role.id}
                  size="sm"
                  data-testid={`organization-role-row-${role.id}`}
                >
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <CardTitle>{role.label}</CardTitle>
                        <CardDescription>
                          {role.key} · {formatRoleScope(role.scope, t)}
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
                        {!role.archivedAt ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyArchiveRoleId === role.id}
                            onClick={() => {
                              void (async () => {
                                setCatalogError(null);
                                setBusyArchiveRoleId(role.id);
                                const result =
                                  await archiveOrganizationCustomRoleAction({
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
                          >
                            {t('roleCatalog.actions.archive')}
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

                    <Collapsible open={editingRoleId === role.id}>
                      <CollapsibleContent className="flex flex-col gap-3">
                        <Separator />
                        {editingRoleId === role.id && editingDraft ? (
                          <div className="flex flex-col gap-3">
                            <FieldGroup>
                              <Field>
                                <FieldLabel htmlFor={`edit-key-${role.id}`}>
                                  {t('roleCatalog.create.roleKeyLabel')}
                                </FieldLabel>
                                <Input
                                  id={`edit-key-${role.id}`}
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
                                <FieldLabel htmlFor={`edit-label-${role.id}`}>
                                  {t('roleCatalog.create.roleLabelLabel')}
                                </FieldLabel>
                                <Input
                                  id={`edit-label-${role.id}`}
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
                                  htmlFor={`edit-description-${role.id}`}
                                >
                                  {t('roleCatalog.create.descriptionLabel')}
                                </FieldLabel>
                                <Textarea
                                  id={`edit-description-${role.id}`}
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
                                fieldIdPrefix={`edit-role-permission-${role.id}`}
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
                            </FieldGroup>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                data-testid={`organization-role-save-${role.id}`}
                                disabled={busyEditRoleId === role.id}
                                onClick={() => {
                                  void (async () => {
                                    setCatalogError(null);
                                    const parsedDraft =
                                      roleUpdateSchema.safeParse(editingDraft);
                                    if (!parsedDraft.success) {
                                      setCatalogError(
                                        parsedDraft.error.issues[0]?.message ??
                                          t(
                                            'roleCatalog.errors.invalidUpdatePayload'
                                          )
                                      );
                                      return;
                                    }

                                    setBusyEditRoleId(role.id);
                                    const result =
                                      await updateOrganizationCustomRoleAction({
                                        roleId: role.id,
                                        key: parsedDraft.data.key,
                                        label: parsedDraft.data.label,
                                        description:
                                          parsedDraft.data.description,
                                        permissionKeys:
                                          parsedDraft.data.permissionKeys,
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
