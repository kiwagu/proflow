'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { useForm } from '@workspace/ui/components/tanstack-form';
import Link from 'next/link';

import { createClient } from '@/lib/supabase/client';
import { setPasswordForSpaceInviteAction } from '@/lib/space-invite.set-password.actions';
import {
  spaceInviteSetPasswordSchema,
  type SpaceInviteSetPasswordValues,
} from '@/lib/space-invite.set-password.schema';

type SpaceInviteSetPasswordClientProps = Readonly<{
  inviteToken: string;
  initialSession: boolean;
}>;

export function SpaceInviteSetPasswordClient({
  inviteToken,
  initialSession,
}: SpaceInviteSetPasswordClientProps) {
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(initialSession);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function boot(): Promise<void> {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled && !error) {
          url.searchParams.delete('code');
          url.searchParams.delete('type');
          window.history.replaceState(
            {},
            '',
            `${url.pathname}${url.search}${url.hash}`
          );
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!cancelled) {
        setSessionReady(!!session);
      }
    }

    void boot();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setSessionReady(!!session);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const form = useForm({
    defaultValues: {
      password: '',
      confirmPassword: '',
    } satisfies SpaceInviteSetPasswordValues,
    validators: {
      onSubmit: spaceInviteSetPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const result = await setPasswordForSpaceInviteAction(inviteToken, value);
      if (!result.ok) {
        setSubmitError(result.message);
        return;
      }
      router.replace(result.nextPath);
      router.refresh();
    },
  });

  if (!sessionReady) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Signing you in</CardTitle>
          <CardDescription>
            Completing email verification. If this takes too long, open the
            invite link from your email again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild variant="outline">
            <Link href="/" prefetch={false}>
              Back to home
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Set your password</CardTitle>
        <CardDescription>
          Choose a password for your account to finish joining the space.
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
            <form.Field name="password">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      autoComplete="new-password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={isInvalid}
                    />
                    {isInvalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : (
                      <FieldDescription>
                        At least 8 characters.
                      </FieldDescription>
                    )}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="confirmPassword">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>
                      Confirm password
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      autoComplete="new-password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={isInvalid}
                    />
                    {isInvalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>
          {submitError ? (
            <p className="text-destructive text-sm" role="alert">
              {submitError}
            </p>
          ) : null}
          <Button type="submit" className="w-fit">
            Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
