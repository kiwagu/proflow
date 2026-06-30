import { Suspense } from 'react';

import { Skeleton } from '@workspace/ui/components/skeleton';

import { AccountShellWithNav } from './account.shell.server';

function AccountLayoutFallback() {
  return (
    <div className="bg-background flex min-h-svh w-full flex-col">
      <Skeleton className="bg-muted/30 h-14 w-full rounded-none" />
      <div className="flex min-h-0 flex-1">
        <Skeleton className="bg-muted/20 w-56 shrink-0 rounded-none" />
        <div className="flex-1 p-6">
          <Skeleton className="bg-muted/50 mx-auto h-96 max-w-5xl rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AccountLayoutFallback />}>
      <AccountShellWithNav>{children}</AccountShellWithNav>
    </Suspense>
  );
}
