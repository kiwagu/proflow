'use client';

import { cn } from '@workspace/ui/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import {
  absoluteUrlForGatewayPath,
  isGatewaySiblingPath,
  platformRouterPathFromGatewayNext,
} from '@workspace/gateway-auth/post-auth-navigation';
import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';
import { resolvedNextPath } from '@workspace/gateway-auth/safe-next-path';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export type LoginFormCopy = Readonly<{
  title: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  forgotPasswordLabel: string;
  requiredError: string;
  submitLabel: string;
  submitPendingLabel: string;
  signUpPrompt: string;
  signUpLabel: string;
}>;

const defaultCopy: LoginFormCopy = {
  title: 'Sign in',
  emailLabel: 'Email',
  emailPlaceholder: 'm@example.com',
  passwordLabel: 'Password',
  forgotPasswordLabel: 'Forgot your password?',
  requiredError: 'Email and password are required',
  submitLabel: 'Login',
  submitPendingLabel: 'Logging in...',
  signUpPrompt: 'No invite and need your own account?',
  signUpLabel: 'Sign up',
};

async function waitForSignedInSession(
  supabase: ReturnType<typeof createClient>
): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      subscription.unsubscribe();
      resolve(false);
    }, 10_000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        return;
      }
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
      resolve(true);
    });
  });
}

export function LoginForm({
  className,
  copy = defaultCopy,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  copy?: LoginFormCopy;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const emailFromForm = String(formData.get('email') ?? '').trim();
    const passwordFromForm = String(formData.get('password') ?? '');
    const emailToSubmit = (email || emailFromForm).trim();
    const passwordToSubmit = password || passwordFromForm;
    if (!emailToSubmit || !passwordToSubmit) {
      setError(copy.requiredError);
      return;
    }
    if (email !== emailToSubmit) {
      setEmail(emailToSubmit);
    }
    if (password !== passwordToSubmit) {
      setPassword(passwordToSubmit);
    }
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailToSubmit,
        password: passwordToSubmit,
      });
      if (error) throw error;
      const sessionReady = await waitForSignedInSession(supabase);
      if (!sessionReady) {
        throw new Error('Sign-in did not finish. Please try again.');
      }

      const nextPath = resolvedNextPath(searchParams.get('next'), '/profile');
      const platformInternal = platformRouterPathFromGatewayNext(nextPath);
      const destinationPath =
        platformInternal !== null
          ? gatewayPlatformMountedPath(platformInternal)
          : isGatewaySiblingPath(nextPath)
            ? nextPath
            : gatewayPlatformMountedPath(nextPath);

      window.location.assign(
        absoluteUrlForGatewayPath(window.location.origin, destinationPath)
      );
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl" data-testid="auth-login-title">
            {copy.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleLogin} data-testid="auth-login-form">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">{copy.emailLabel}</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={copy.emailPlaceholder}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="auth-login-email"
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">
                    {copy.passwordLabel}
                  </FieldLabel>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                    data-testid="auth-login-forgot-password"
                  >
                    {copy.forgotPasswordLabel}
                  </Link>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="auth-login-password"
                />
              </Field>
              {error && (
                <p
                  className="text-destructive text-sm"
                  data-testid="auth-login-error"
                >
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                data-testid="auth-login-submit"
              >
                {isLoading ? copy.submitPendingLabel : copy.submitLabel}
              </Button>
            </FieldGroup>
            <div className="mt-4 text-center text-sm">
              {copy.signUpPrompt}{' '}
              <Link
                href="/auth/sign-up"
                className="underline underline-offset-4"
                data-testid="auth-login-sign-up"
              >
                {copy.signUpLabel}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
