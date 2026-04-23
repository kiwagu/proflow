'use client';

import { useCallback, useState } from 'react';

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
import { Textarea } from '@workspace/ui/components/textarea';

import type { ProfileFormValues } from './profile.schema';
import { profileSchema } from './profile.schema';
import type { UpdateProfileResult } from './profile.actions';
import { ProfileAvatarUpload } from './profile-avatar-upload';

type ProfileFormProps = {
  initialValues: ProfileFormValues;
  userId: string;
  onSubmitProfile: (values: ProfileFormValues) => Promise<UpdateProfileResult>;
};

export function ProfileForm({
  initialValues,
  userId,
  onSubmitProfile,
}: ProfileFormProps) {
  const [submitState, setSubmitState] = useState<UpdateProfileResult | null>(
    null
  );

  // Expose a deterministic hydration marker for the profile e2e flow before
  // the browser paints, so the form can be used as a stable ready signal
  // without triggering an extra render from an effect.
  // @see tests/e2e/src/auth-profile.e2e.spec.ts#test('@smoke user can login and persist profile edit').
  const attachHydratedMarker = useCallback(
    (formElement: HTMLFormElement | null) => {
      if (!formElement) {
        return;
      }

      formElement.setAttribute('data-hydrated', 'true');
    },
    []
  );

  const form = useForm({
    defaultValues: initialValues,
    validators: {
      onSubmit: profileSchema,
    },
    onSubmit: async ({ value }) => {
      const result = await onSubmitProfile(value);
      setSubmitState(result);
    },
  });

  return (
    <form
      ref={attachHydratedMarker}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-4"
      noValidate
      data-testid="profile-form"
    >
      <FieldGroup>
        <form.Field name="email">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Contact email</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="name@example.com"
                  autoComplete="email"
                  data-testid="profile-email"
                />
                <FieldDescription>
                  Additional profile field. It does not affect authentication
                  email.
                </FieldDescription>
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="display_name">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Display name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="How should we call you?"
                  autoComplete="name"
                  data-testid="profile-display-name"
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="avatar_url">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Avatar URL</FieldLabel>
                <ProfileAvatarUpload
                  value={field.state.value}
                  onChange={(url) => field.handleChange(url)}
                  userId={userId}
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="bio">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Bio</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="A short bio"
                  rows={4}
                  className="min-h-24"
                  data-testid="profile-bio"
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      {submitState?.ok ? (
        <p className="text-primary text-sm" data-testid="profile-save-success">
          Profile saved.
        </p>
      ) : null}
      {submitState && !submitState.ok ? (
        <p
          className="text-destructive text-sm"
          data-testid="profile-save-error"
        >
          {submitState.message}
        </p>
      ) : null}

      <div>
        <Button type="submit" data-testid="profile-save-submit">
          Save profile
        </Button>
      </div>
    </form>
  );
}
