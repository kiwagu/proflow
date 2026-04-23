'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { useForm } from '@workspace/ui/components/tanstack-form';

import type { OrganizationBootstrapResult } from './organization.bootstrap.actions';
import {
  organizationBootstrapSchema,
  type OrganizationBootstrapValues,
} from './organization.bootstrap.schema';

type OrganizationBootstrapFormProps = {
  onSubmitBootstrap: (
    values: OrganizationBootstrapValues
  ) => Promise<OrganizationBootstrapResult>;
};

export function OrganizationBootstrapForm({
  onSubmitBootstrap,
}: OrganizationBootstrapFormProps) {
  const router = useRouter();
  const [submitState, setSubmitState] =
    useState<OrganizationBootstrapResult | null>(null);

  const form = useForm({
    defaultValues: {
      orgName: '',
      orgSlug: '',
      spaceName: '',
      spaceSlug: '',
    } satisfies OrganizationBootstrapValues,
    validators: {
      onSubmit: organizationBootstrapSchema,
    },
    onSubmit: async ({ value }) => {
      const result = await onSubmitBootstrap(value);
      setSubmitState(result);
      if (result.ok) {
        router.replace('/profile');
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex max-w-md flex-col gap-4"
      noValidate
    >
      <FieldGroup>
        <form.Field name="orgName">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Organization name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  autoComplete="organization"
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="orgSlug">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  Organization URL slug
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="spaceName">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>First space name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="spaceSlug">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Space URL slug</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>
      {submitState && !submitState.ok ? (
        <p className="text-destructive text-sm" role="alert">
          {submitState.message}
        </p>
      ) : null}
      <Button type="submit">Create organization and space</Button>
    </form>
  );
}
