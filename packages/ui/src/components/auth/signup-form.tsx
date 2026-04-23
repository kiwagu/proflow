import type { SyntheticEvent } from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';

export type SignupFormProps = Omit<
  React.ComponentProps<typeof Card>,
  'onSubmit'
> & {
  title?: string;
  description?: string;
  onSubmit?: (e: SyntheticEvent<HTMLFormElement>) => void;
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  onNameChange?: (value: string) => void;
  onEmailChange?: (value: string) => void;
  onPasswordChange?: (value: string) => void;
  onConfirmPasswordChange?: (value: string) => void;
  error?: string | null;
  isSubmitting?: boolean;
  idPrefix?: string;
  showOAuth?: boolean;
  onRequestSignIn?: () => void;
};

export function SignupForm({
  title = 'Create an account',
  description = 'Enter your information below to create your account',
  onSubmit,
  name = '',
  email = '',
  password = '',
  confirmPassword = '',
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  error,
  isSubmitting = false,
  idPrefix = 'signup',
  showOAuth = true,
  onRequestSignIn,
  ...cardProps
}: SignupFormProps) {
  const controlled = Boolean(onSubmit);

  return (
    <Card {...cardProps}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={controlled ? onSubmit : undefined}>
          <FieldGroup>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-name`}>Full Name</FieldLabel>
              <Input
                id={`${idPrefix}-name`}
                type="text"
                placeholder="John Doe"
                required
                disabled={controlled ? isSubmitting : undefined}
                autoComplete="name"
                {...(controlled
                  ? {
                      onChange: (e) => onNameChange?.(e.target.value),
                      value: name,
                    }
                  : {})}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-email`}>Email</FieldLabel>
              <Input
                id={`${idPrefix}-email`}
                type="email"
                placeholder="m@example.com"
                required
                disabled={controlled ? isSubmitting : undefined}
                autoComplete="email"
                {...(controlled
                  ? {
                      onChange: (e) => onEmailChange?.(e.target.value),
                      value: email,
                    }
                  : {})}
              />
              <FieldDescription>
                We&apos;ll use this to contact you. We will not share your email
                with anyone else.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-password`}>Password</FieldLabel>
              <Input
                id={`${idPrefix}-password`}
                type="password"
                required
                disabled={controlled ? isSubmitting : undefined}
                autoComplete="new-password"
                {...(controlled
                  ? {
                      onChange: (e) => onPasswordChange?.(e.target.value),
                      value: password,
                    }
                  : {})}
              />
              <FieldDescription>
                Must be at least 8 characters long.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-confirm-password`}>
                Confirm Password
              </FieldLabel>
              <Input
                id={`${idPrefix}-confirm-password`}
                type="password"
                required
                disabled={controlled ? isSubmitting : undefined}
                autoComplete="new-password"
                {...(controlled
                  ? {
                      onChange: (e) =>
                        onConfirmPasswordChange?.(e.target.value),
                      value: confirmPassword,
                    }
                  : {})}
              />
              <FieldDescription>Please confirm your password.</FieldDescription>
            </Field>
            <FieldGroup>
              <Field>
                <Button
                  type="submit"
                  disabled={controlled ? isSubmitting : undefined}
                >
                  {controlled && isSubmitting
                    ? 'Creating account…'
                    : 'Create Account'}
                </Button>
                {showOAuth ? (
                  <Button variant="outline" type="button">
                    Sign up with Google
                  </Button>
                ) : null}
                <FieldDescription className="px-6 text-center">
                  Already have an account?{' '}
                  {onRequestSignIn ? (
                    <button
                      type="button"
                      className="underline-offset-4 hover:underline"
                      onClick={onRequestSignIn}
                    >
                      Sign in
                    </button>
                  ) : (
                    <a href="#">Sign in</a>
                  )}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
