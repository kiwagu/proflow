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
import { SpaceInviteSetPasswordClient } from '@/app/invite/set-password/space-invite.set-password.client';
import { createClient } from '@/lib/supabase/server';

type PageProps = {
  searchParams: Promise<{ t?: string }>;
};

function SetPasswordFallback() {
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

async function SetPasswordContent({ searchParams }: PageProps) {
  await connection();
  const sp = await searchParams;
  const token = typeof sp.t === 'string' ? sp.t.trim() : '';
  if (!token) {
    redirect('/invite/error?reason=missing_token');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
      <SpaceInviteSetPasswordClient
        inviteToken={token}
        initialSession={!!user}
      />
    </div>
  );
}

export default function InviteSetPasswordPage(props: PageProps) {
  return (
    <Suspense fallback={<SetPasswordFallback />}>
      <SetPasswordContent searchParams={props.searchParams} />
    </Suspense>
  );
}
