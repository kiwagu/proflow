'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { useForm } from '@workspace/ui/components/tanstack-form';
import { cn } from '@workspace/ui/lib/utils';

import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';

import { createSpaceAction } from './space.create.actions';
import {
  createSpaceCreateSchema,
  type SpaceCreateFormValues,
} from './space.create.schema';

const selectClassName = cn(
  'border-input bg-background ring-offset-background',
  'focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs',
  'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50'
);

type SpaceCreateFormProps = {
  orgOptions: ReadonlyArray<{ id: string; name: string; slug: string }>;
  locale: SpaceSettingsLocale;
};

export function SpaceCreateForm({ orgOptions, locale }: SpaceCreateFormProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const [submitState, setSubmitState] = useState<{
    ok: boolean;
    message?: string;
  } | null>(null);

  const defaultOrgId = orgOptions[0]?.id ?? '';

  const form = useForm({
    defaultValues: {
      organizationId: defaultOrgId,
      name: '',
      slug: '',
    } satisfies SpaceCreateFormValues,
    validators: {
      onSubmit: createSpaceCreateSchema(t),
    },
    onSubmit: async ({ value }) => {
      const result = await createSpaceAction(value, locale);
      setSubmitState(
        result.ok ? { ok: true } : { ok: false, message: result.message }
      );
      if (result.ok) {
        form.reset({
          organizationId: value.organizationId,
          name: '',
          slug: '',
        });
        router.refresh();
      }
    },
  });

  if (orgOptions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('spaceCreate.noOrganizations')}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex max-w-md flex-col gap-4"
      noValidate
      data-testid="space-create-form"
    >
      <FieldGroup>
        {orgOptions.length > 1 ? (
          <form.Field name="organizationId">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>
                    {t('spaceCreate.organizationLabel')}
                  </FieldLabel>
                  <select
                    id={field.name}
                    name={field.name}
                    className={selectClassName}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={isInvalid}
                    data-testid="space-create-organization"
                  >
                    {orgOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.slug})
                      </option>
                    ))}
                  </select>
                  <FieldDescription>
                    {t('spaceCreate.organizationDescription')}
                  </FieldDescription>
                  {isInvalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              );
            }}
          </form.Field>
        ) : (
          <form.Field name="organizationId">
            {(field) => (
              <input
                type="hidden"
                name={field.name}
                value={field.state.value}
              />
            )}
          </form.Field>
        )}

        {orgOptions.length === 1 ? (
          <div className="text-muted-foreground text-sm">
            {t('spaceCreate.selectedOrganization')}{' '}
            <span className="text-foreground font-medium">
              {orgOptions[0]?.name}
            </span>{' '}
            <span className="font-mono text-xs">({orgOptions[0]?.slug})</span>
          </div>
        ) : null}

        <form.Field name="name">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  {t('spaceCreate.nameLabel')}
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                  data-testid="space-create-name"
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="slug">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  {t('spaceCreate.slugLabel')}
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                  placeholder={t('spaceCreate.slugPlaceholder')}
                  data-testid="space-create-slug"
                />
                <FieldDescription>
                  {t('spaceCreate.slugDescription')}
                </FieldDescription>
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      {submitState && !submitState.ok && submitState.message ? (
        <p className="text-destructive text-sm" role="alert">
          {submitState.message}
        </p>
      ) : null}
      {submitState?.ok ? (
        <p className="text-primary text-sm font-medium" role="status">
          {t('spaceCreate.success')}
        </p>
      ) : null}

      <Button type="submit" data-testid="space-create-submit">
        {t('spaceCreate.submit')}
      </Button>
    </form>
  );
}
