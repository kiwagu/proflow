import { useState } from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import {
  CheckboxGroupField,
  toggleGroupKey,
} from '@workspace/ui/components/platform/checkbox-group-field';
import { ConfirmCheckboxField } from '@workspace/ui/components/confirm-checkbox-field';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { useForm } from '@workspace/ui/components/tanstack-form';
import { Textarea } from '@workspace/ui/components/textarea';

import type { RoleCatalogMutateResult } from '@/lib/platform-role-catalog.actions';

import type { RoleFormSchema, Translator } from './role-catalog.schema';

export type RoleCreateFormCopy = Readonly<{
  cardTitle: string;
  cardDescription: string;
  keyHint: string;
  descriptionPlaceholder: string;
  submitLabel: string;
}>;

type RoleCreateFormProps = Readonly<{
  t: Translator;
  roleSchema: RoleFormSchema;
  permissionCatalogKeys: readonly string[];
  catalogError: string | null;
  onError: (message: string | null) => void;
  onCreated: () => void;
  copy: RoleCreateFormCopy;
  fieldIdPrefix: string;
  cardTestId: string;
  /** Wire `name` / `aria-invalid` / inline `FieldError` per field (org variant). */
  showFieldErrors?: boolean;
  /** Optional `data-testid` on the `<form>` element (org variant). */
  formTestId?: string;
  /**
   * Confirm-gate slot (system variant). When provided, renders the confirm
   * checkbox, gates the submit button behind it, and forwards its value to the
   * create action.
   */
  confirm?: Readonly<{
    inputId: string;
    label: string;
  }>;
  onSubmit: (
    payload: Readonly<{
      key: string;
      label: string;
      description: string;
      permissionKeys: string[];
      confirmed: boolean;
    }>
  ) => Promise<RoleCatalogMutateResult>;
}>;

export function RoleCreateForm({
  t,
  roleSchema,
  permissionCatalogKeys,
  catalogError,
  onError,
  onCreated,
  copy,
  fieldIdPrefix,
  cardTestId,
  showFieldErrors = false,
  formTestId,
  confirm,
  onSubmit,
}: RoleCreateFormProps) {
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

      const result = await onSubmit({
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
    <Card data-testid={cardTestId}>
      <CardHeader>
        <CardTitle>{copy.cardTitle}</CardTitle>
        <CardDescription>{copy.cardDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
          data-testid={formTestId}
        >
          <FieldGroup>
            <form.Field name="key">
              {(field) => {
                const isInvalid =
                  showFieldErrors &&
                  field.state.meta.isTouched &&
                  !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>
                      {t('roleCatalog.create.roleKeyLabel')}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={showFieldErrors ? field.name : undefined}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value.toLowerCase())
                      }
                      placeholder={t('roleCatalog.create.roleKeyPlaceholder')}
                      aria-invalid={showFieldErrors ? isInvalid : undefined}
                    />
                    {isInvalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : (
                      <FieldDescription>{copy.keyHint}</FieldDescription>
                    )}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="label">
              {(field) => {
                const isInvalid =
                  showFieldErrors &&
                  field.state.meta.isTouched &&
                  !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>
                      {t('roleCatalog.create.roleLabelLabel')}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={showFieldErrors ? field.name : undefined}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder={t('roleCatalog.create.roleLabelPlaceholder')}
                      aria-invalid={showFieldErrors ? isInvalid : undefined}
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
                  showFieldErrors &&
                  field.state.meta.isTouched &&
                  !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>
                      {t('roleCatalog.create.descriptionLabel')}
                    </FieldLabel>
                    <Textarea
                      id={field.name}
                      name={showFieldErrors ? field.name : undefined}
                      rows={2}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder={copy.descriptionPlaceholder}
                      aria-invalid={showFieldErrors ? isInvalid : undefined}
                    />
                    {isInvalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                );
              }}
            </form.Field>

            <Field data-invalid={createPermissionKeys.length === 0}>
              <CheckboxGroupField
                fieldIdPrefix={fieldIdPrefix}
                legend={t('roleCatalog.permission.legend')}
                description={t('roleCatalog.permission.description')}
                items={permissionCatalogKeys.map((key) => ({
                  key,
                  label: key,
                }))}
                selectedKeys={createPermissionKeys}
                onToggle={(permissionKey, checked) => {
                  setCreatePermissionKeys((current) =>
                    toggleGroupKey(current, permissionKey, checked)
                  );
                }}
              />
            </Field>

            {confirm ? (
              <ConfirmCheckboxField
                inputId={confirm.inputId}
                checked={createConfirmed}
                onCheckedChange={setCreateConfirmed}
                label={confirm.label}
              />
            ) : null}
          </FieldGroup>

          {catalogError ? (
            <FieldError className="text-destructive text-sm">
              {catalogError}
            </FieldError>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={confirm ? !createConfirmed : undefined}
            >
              {copy.submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
