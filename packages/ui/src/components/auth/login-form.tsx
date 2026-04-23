import type { SyntheticEvent } from 'react';

import { cn } from '@workspace/ui/lib/utils';
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

export type LoginFormProps = Omit<React.ComponentProps<'div'>, 'onSubmit'> & {
  title?: string;
  description?: string;
  /** Controlled mode: submit handler, paired with email/password + change handlers */
  onSubmit?: (e: SyntheticEvent<HTMLFormElement>) => void;
  email?: string;
  password?: string;
  onEmailChange?: (value: string) => void;
  onPasswordChange?: (value: string) => void;
  error?: string | null;
  isSubmitting?: boolean;
  /** Prefix for input ids (avoid duplicates when multiple forms on page) */
  idPrefix?: string;
  showForgotPassword?: boolean;
  showOAuth?: boolean;
  /** When set, "Sign up" triggers this instead of navigating */
  onRequestSignUp?: () => void;
};

export function LoginForm({
  className,
  title = 'Login to your account',
  description = 'Enter your email below to login to your account',
  onSubmit,
  email = '',
  password = '',
  onEmailChange,
  onPasswordChange,
  error,
  isSubmitting = false,
  idPrefix = 'login',
  showForgotPassword = true,
  showOAuth = true,
  onRequestSignUp,
  ...props
}: LoginFormProps) {
  const controlled = Boolean(onSubmit);

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
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
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor={`${idPrefix}-password`}>
                    Password
                  </FieldLabel>
                  {showForgotPassword ? (
                    <a
                      href="#"
                      className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </a>
                  ) : null}
                </div>
                <Input
                  id={`${idPrefix}-password`}
                  type="password"
                  required
                  disabled={controlled ? isSubmitting : undefined}
                  autoComplete="current-password"
                  {...(controlled
                    ? {
                        onChange: (e) => onPasswordChange?.(e.target.value),
                        value: password,
                      }
                    : {})}
                />
              </Field>
              <Field>
                <Button
                  type="submit"
                  disabled={controlled ? isSubmitting : undefined}
                >
                  {controlled && isSubmitting ? 'Signing in…' : 'Login'}
                </Button>
                {showOAuth ? (
                  <Button variant="outline" type="button">
                    Login with Google
                  </Button>
                ) : null}
                <FieldDescription className="text-center">
                  Don&apos;t have an account?{' '}
                  {onRequestSignUp ? (
                    <button
                      type="button"
                      className="underline-offset-4 hover:underline"
                      onClick={onRequestSignUp}
                    >
                      Sign up
                    </button>
                  ) : (
                    <a href="#">Sign up</a>
                  )}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
