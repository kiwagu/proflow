'use client';

import { Button } from '@workspace/ui/components/button';
import { ConfirmCheckboxField } from '@workspace/ui/components/confirm-checkbox-field';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Textarea } from '@workspace/ui/components/textarea';

import type { PlatformSuperAdminController } from './platform-super-admin.hook';
import type { Translator } from './platform-super-admin.schema';

type PlatformSuperAdminGrantFormProps = Readonly<{
  form: PlatformSuperAdminController['grantForm'];
  t: Translator;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  atCapacity: boolean;
  catalogError: string | null;
  successMessage: string | null;
}>;

export function PlatformSuperAdminGrantForm({
  form,
  t,
  confirmed,
  onConfirmedChange,
  atCapacity,
  catalogError,
  successMessage,
}: PlatformSuperAdminGrantFormProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium">
          {t('superAdmin.platformAdmins.grant.title')}
        </h3>
        <p className="text-muted-foreground text-sm">
          {t('superAdmin.platformAdmins.grant.description')}
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FieldGroup>
          <form.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t('superAdmin.platformAdmins.grant.emailLabel')}
                </FieldLabel>
                <Input
                  id={field.name}
                  type="email"
                  data-testid="platform-super-admin-grant-email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.target.value.toLowerCase())
                  }
                  placeholder={t(
                    'superAdmin.platformAdmins.grant.emailPlaceholder'
                  )}
                />
                <FieldDescription>
                  {t('superAdmin.platformAdmins.grant.emailDescription')}
                </FieldDescription>
              </Field>
            )}
          </form.Field>

          <form.Field name="reason">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t('superAdmin.platformAdmins.grant.reasonLabel')}
                </FieldLabel>
                <Textarea
                  id={field.name}
                  rows={3}
                  data-testid="platform-super-admin-grant-reason"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={t(
                    'superAdmin.platformAdmins.grant.reasonPlaceholder'
                  )}
                />
                <FieldDescription>
                  {t('superAdmin.platformAdmins.grant.reasonDescription')}
                </FieldDescription>
              </Field>
            )}
          </form.Field>

          <ConfirmCheckboxField
            inputId="grant-platform-super-admin-confirm"
            labelAs="title"
            labelId="platform-super-admin-grant-confirm-label"
            checked={confirmed}
            onCheckedChange={onConfirmedChange}
            label={t('superAdmin.platformAdmins.grant.confirm')}
            checkboxProps={{
              'data-testid': 'platform-super-admin-grant-confirm',
            }}
          />
        </FieldGroup>

        {catalogError ? (
          <FieldError className="text-destructive text-sm">
            {catalogError}
          </FieldError>
        ) : null}
        {successMessage ? (
          <p className="text-sm text-emerald-700" role="status">
            {successMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={!confirmed || atCapacity}
            data-testid="platform-super-admin-grant-submit"
          >
            {t('superAdmin.platformAdmins.grant.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
