import { connection } from 'next/server';
import { Suspense } from 'react';
import Link from 'next/link';

import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Skeleton } from '@workspace/ui/components/skeleton';

type PageProps = {
  searchParams: Promise<{ reason?: string }>;
};

const REASON_TEXT: Record<string, string> = {
  missing_token: 'The invite link is incomplete.',
  invalid_invite: 'This invite is not valid or was revoked.',
  expired: 'This invite has expired. Ask for a new invite.',
  server_misconfigured: 'The server is not configured for invite sign-up.',
  auth_create_failed: 'Could not prepare your account. Contact support.',
  magic_link_failed: 'Could not start sign-in. Try again later.',
  magic_callback_invalid:
    'The sign-in link is incomplete. Open the link from your invite email again.',
  magic_exchange_failed:
    'Could not verify sign-in. Open the invite link from your email again.',
  magic_missing_code:
    'Sign-in did not complete. Open the invite link from your email again.',
  session_expired:
    'Your session has expired. Open the invite link from your email again.',
  accept_failed:
    'Could not accept this invite. It may have been revoked or already used.',
};

function InviteErrorFallback() {
  return (
    <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invite</CardTitle>
          <CardDescription className="sr-only">Loading</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton
            className="bg-muted/50 h-16 w-full rounded-md"
            aria-hidden
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function InviteErrorContent({ searchParams }: PageProps) {
  await connection();
  const sp = await searchParams;
  const reason = typeof sp.reason === 'string' ? sp.reason : '';
  const detail =
    reason && REASON_TEXT[reason]
      ? REASON_TEXT[reason]
      : 'This link is not valid.';

  return (
    <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
      <Card className="w-full max-w-md" data-testid="invite-error-card">
        <CardHeader>
          <CardTitle data-testid="invite-error-title">
            Invite link problem
          </CardTitle>
          <CardDescription data-testid="invite-error-detail">
            {detail}
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

export default function InviteErrorPage(props: PageProps) {
  return (
    <Suspense fallback={<InviteErrorFallback />}>
      <InviteErrorContent searchParams={props.searchParams} />
    </Suspense>
  );
}
