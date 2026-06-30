import { useState } from 'react';

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
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { useForm } from '@workspace/ui/components/tanstack-form';
import { Textarea } from '@workspace/ui/components/textarea';

import { createGlobalSystemRoleAction } from '@/lib/platform-role-catalog.actions';

import type {
  RoleFormSchema,
  Translator,
} from './global-system-role-catalog.schema';
import {
  PermissionField,
  togglePermissionKey,
} from './global-system-role-permission-field';

type GlobalSystemRoleCreateFormProps = Readonly<{
  t: Translator;
  roleSchema: RoleFormSchema;
  permissionCatalogKeys: readonly string[];
  catalogError: string | null;
  onError: (message: string | null) => void;
  onCreated: () => void;
}>;

export function GlobalSystemRoleCreateForm({
  t,
  roleSchema,
  permissionCatalogKeys,
  catalogError,
  onError,
  onCreated,
}: GlobalSystemRoleCreateFormProps) {
  const [createPermissionKeys, setCreatePermissionKeys] = useState<string[]>(
    []
  );
  const [createConfirmed, setCreateConfirmed] = useState(false);

  const form = useForm({
    defaultValues: {
      key: '',
      label: '',
      description: '',
    },
    onSubmit: async ({ value }) => {
      onError(null);

      const parsedPayload = roleSchema.safeParse({
        ...value,
        permissionKeys: createPermissionKeys,
      });
      if (!parsedPayload.success) {
        onError(
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
        onError(result.message);
        return;
      }

      form.reset({
        key: '',
        label: '',
        description: '',
      });
      setCreatePermissionKeys([]);
      setCreateConfirmed(false);
      onCreated();
    },
  });

  return (
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
                    onChange={(event) => field.handleChange(event.target.value)}
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
                    onChange={(event) => field.handleChange(event.target.value)}
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
                onCheckedChange={(value) => setCreateConfirmed(value === true)}
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
  );
}
