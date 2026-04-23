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
import Link from 'next/link';

import { exchangeInviteMagicCallbackAction } from '@/lib/space-invite.magic-callback.actions';
import { createClient } from '@/lib/supabase/client';

type InviteMagicCallbackClientProps = Readonly<{
  inviteToken: string;
  nextStep: 'password' | 'complete';
  initialCode: string | null;
}>;

export function InviteMagicCallbackClient({
  inviteToken,
  nextStep,
  initialCode,
}: InviteMagicCallbackClientProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    let unsubscribe: (() => void) | undefined;

    async function run(): Promise<void> {
      const url = new URL(window.location.href);
      const supabase = createClient();

      /*
       * generateLink (admin API) produces an implicit-flow action link.
       * GoTrue redirects back with #access_token=…&refresh_token=… (hash fragment).
       * If the app ever switches to PKCE, GoTrue sends ?code=… instead.
       */
      const code = initialCode ?? url.searchParams.get('code');
      if (code) {
        const exchanged = await exchangeInviteMagicCallbackAction(code);
        if (cancelled) return;
        if (!exchanged.ok) {
          setMessage(exchanged.message);
          return;
        }
        url.searchParams.delete('code');
        url.searchParams.delete('type');
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
      }

      if (!code && url.hash.length > 1) {
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (cancelled) return;
          if (error) {
            setMessage(
              process.env.NODE_ENV === 'development'
                ? error.message
                : 'Could not verify sign-in.'
            );
            return;
          }
          window.history.replaceState({}, '', `${url.pathname}${url.search}`);
        }
      }

      const tryNavigate = async (): Promise<boolean> => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || !session) {
          return false;
        }
        const dest =
          nextStep === 'password'
            ? `/invite/set-password?t=${encodeURIComponent(inviteToken)}`
            : `/invite/complete?t=${encodeURIComponent(inviteToken)}`;
        router.replace(dest);
        router.refresh();
        return true;
      };

      if (await tryNavigate()) {
        return;
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(() => {
        void (async () => {
          if (await tryNavigate()) {
            subscription.unsubscribe();
          }
        })();
      });
      unsubscribe = () => subscription.unsubscribe();

      timeoutId = window.setTimeout(() => {
        void (async () => {
          if (cancelled) return;
          if (await tryNavigate()) {
            return;
          }
          setMessage(
            'Sign-in did not finish. Open the invite link from your email again.'
          );
        })();
      }, 12_000);
    }

    void run();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      unsubscribe?.();
    };
  }, [initialCode, inviteToken, nextStep, router]);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Signing you in</CardTitle>
        <CardDescription>
          Completing your invite. This should only take a moment.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {message ? (
          <p className="text-destructive text-sm" role="alert">
            {message}
          </p>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/" prefetch={false}>
            Back to home
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
