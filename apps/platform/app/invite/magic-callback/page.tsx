import { connection } from 'next/server';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { InviteMagicCallbackClient } from '@/app/invite/magic-callback/invite.magic-callback.client';

type PageProps = {
  searchParams: Promise<{
    t?: string;
    next?: string;
    code?: string;
  }>;
};

function MagicCallbackFallback() {
  return (
    <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invite</CardTitle>
          <CardDescription className="sr-only">Loading</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="bg-muted/50 h-24 w-full animate-pulse rounded-md"
            aria-hidden
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function MagicCallbackContent({ searchParams }: PageProps) {
  await connection();
  const sp = await searchParams;
  const inviteToken = typeof sp.t === 'string' ? sp.t.trim() : '';
  const nextRaw = typeof sp.next === 'string' ? sp.next.trim() : '';
  const nextStep =
    nextRaw === 'password' || nextRaw === 'complete' ? nextRaw : null;
  const initialCode =
    typeof sp.code === 'string' && sp.code.trim() !== ''
      ? sp.code.trim()
      : null;

  if (!inviteToken || !nextStep) {
    redirect('/invite/error?reason=magic_callback_invalid');
  }

  return (
    <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
      <InviteMagicCallbackClient
        inviteToken={inviteToken}
        nextStep={nextStep}
        initialCode={initialCode}
      />
    </div>
  );
}

export default function InviteMagicCallbackPage(props: PageProps) {
  return (
    <Suspense fallback={<MagicCallbackFallback />}>
      <MagicCallbackContent searchParams={props.searchParams} />
    </Suspense>
  );
}
