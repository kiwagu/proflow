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

import { createSpaceInviteAction } from '@/lib/space-invite.manage.actions';
import {
  spaceInviteCreateSchema,
  type SpaceInviteCreateFormValues,
} from '@/lib/space-invite.schema';
import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';
import type { InvitableRoleOption } from '@/app/(account)/organizations/space-invite.manager.client';

const selectClassName = cn(
  'border-input bg-background ring-offset-background',
  'focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs',
  'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50'
);

type SpaceInviteFormProps = Readonly<{
  spaceId: string;
  spaceLabel: string;
  locale: SpaceSettingsLocale;
  roleOptions: readonly InvitableRoleOption[];
  onInviteCreated?: (payload: { token: string; notifyQueued: boolean }) => void;
}>;

export function SpaceInviteForm({
  spaceId,
  spaceLabel,
  locale,
  roleOptions,
  onInviteCreated,
}: SpaceInviteFormProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const [submitState, setSubmitState] = useState<
    { kind: 'idle' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const sortedRoleOptions = [...roleOptions].sort((a, b) => {
    if (a.key === 'member') {
      return -1;
    }
    if (b.key === 'member') {
      return 1;
    }
    return a.label.localeCompare(b.label);
  });

  const defaultRoleKey =
    sortedRoleOptions.find((option) => option.key === 'member')?.key ??
    sortedRoleOptions[0]?.key ??
    '';

  const form = useForm({
    defaultValues: {
      spaceId,
      email: '',
      roleKey: defaultRoleKey,
    },
    onSubmit: async ({ value }) => {
      if (!value.roleKey) {
        setSubmitState({
          kind: 'error',
          message: t('inviteForm.errors.selectRole'),
        });
        return;
      }
      const payload: SpaceInviteCreateFormValues = {
        spaceId,
        email: value.email,
        roleKey: value.roleKey,
      };
      const parsed = spaceInviteCreateSchema.safeParse(payload);
      if (!parsed.success) {
        setSubmitState({
          kind: 'error',
          message:
            parsed.error.issues[0]?.message ??
            t('inviteForm.errors.invalidInput'),
        });
        return;
      }
      const result = await createSpaceInviteAction(parsed.data);
      if (!result.ok) {
        setSubmitState({ kind: 'error', message: result.message });
        return;
      }
      setSubmitState({ kind: 'idle' });
      onInviteCreated?.({
        token: result.token,
        notifyQueued: result.notifyQueued,
      });
      form.reset({
        spaceId,
        email: '',
        roleKey: defaultRoleKey,
      });
      router.refresh();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex w-full max-w-lg min-w-0 flex-col gap-3"
      noValidate
      data-testid={`space-invite-form-${spaceId}`}
    >
      <p className="text-muted-foreground text-xs">
        {t('inviteForm.inviteTo', { spaceLabel })}
      </p>
      <FieldGroup>
        <form.Field name="email">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  {t('inviteForm.emailLabel')}
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  placeholder={t('inviteForm.emailPlaceholder')}
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
                {!isInvalid ? (
                  <FieldDescription>
                    {t('inviteForm.emailDescription')}
                  </FieldDescription>
                ) : null}
              </Field>
            );
          }}
        </form.Field>

        {sortedRoleOptions.length > 1 ? (
          <form.Field name="roleKey">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>
                    {t('inviteForm.roleLabel')}
                  </FieldLabel>
                  <select
                    id={field.name}
                    name={field.name}
                    className={selectClassName}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={isInvalid}
                  >
                    {sortedRoleOptions.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <FieldDescription>
                    {t('inviteForm.roleDescription')}
                  </FieldDescription>
                </Field>
              );
            }}
          </form.Field>
        ) : null}
      </FieldGroup>

      {submitState.kind === 'error' ? (
        <p className="text-destructive text-sm" role="alert">
          {submitState.message}
        </p>
      ) : null}

      <Button type="submit" size="sm" className="w-fit">
        {t('inviteForm.submit')}
      </Button>
    </form>
  );
}
