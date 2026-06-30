import { connection } from 'next/server';
import { Suspense } from 'react';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';

import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Skeleton } from '@workspace/ui/components/skeleton';

import {
  acceptSpaceInviteForSession,
  setActiveSpaceCookieForInvite,
} from '@/lib/space-invite.accept.server';

type PageProps = {
  searchParams: Promise<{ t?: string; token?: string }>;
};

function InviteAcceptFallback() {
  return (
    <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invite</CardTitle>
          <CardDescription className="sr-only">Loading invite</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton
            className="bg-muted/50 h-24 w-full rounded-md"
            aria-hidden
          />
        </CardContent>
      </Card>
    </div>
  );
}

function pickToken(sp: { t?: string; token?: string }): string {
  const raw = typeof sp.t === 'string' ? sp.t : sp.token;
  return typeof raw === 'string' ? raw.trim() : '';
}

async function InviteAcceptContent({ searchParams }: PageProps) {
  await connection();
  const sp = await searchParams;
  const token = pickToken(sp);

  if (!token) {
    return (
      <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid invite link</CardTitle>
            <CardDescription>
              This link is missing an invite token. Ask the person who invited
              you to send the full link again from Space settings → Invitations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/" prefetch={false}>
                Back to home
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const result = await acceptSpaceInviteForSession(token);

  if (result.status === 'unauthenticated') {
    const acceptResume = `${gatewayPlatformMountedPath('/invite/accept')}?${new URLSearchParams({ t: token.trim() }).toString()}`;
    const signInHref = `/?next=${encodeURIComponent(acceptResume)}`;

    return (
      <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Accept Space invite</CardTitle>
            <CardDescription>
              Sign in with the{' '}
              <span className="text-foreground font-medium">same email</span> as
              the invitation, then you will join the Space. New users should use
              the link from the invite email instead (it creates the account).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild>
              <Link href={signInHref} prefetch={false}>
                Sign in to accept
              </Link>
            </Button>
            <p className="text-muted-foreground text-xs">
              No account yet?{' '}
              <Link
                href="/auth/sign-up"
                className="text-foreground font-medium underline"
                prefetch={false}
              >
                Create one
              </Link>{' '}
              using the invited email, then open this link again or use Profile
              → pending invitations.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result.status === 'error') {
    return (
      <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Could not accept invite</CardTitle>
            <CardDescription>{result.message}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild variant="outline">
              <Link href="/profile" prefetch={false}>
                Go to profile
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  await setActiveSpaceCookieForInvite(result.spaceId);
  revalidatePath('/profile');
  revalidatePath('/organizations');
  revalidatePath('/');
  redirect('/profile');
}

/**
 * Next.js 16: `await searchParams`, `cookies()`, and `connection()` in a page
 * must run inside a Suspense boundary or the dev runtime reports a blocking route.
 */
export default function InviteAcceptPage(props: PageProps) {
  return (
    <Suspense fallback={<InviteAcceptFallback />}>
      <InviteAcceptContent searchParams={props.searchParams} />
    </Suspense>
  );
}
