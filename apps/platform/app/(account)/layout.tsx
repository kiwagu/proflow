import { Suspense } from 'react';

import { AccountShellWithNav } from './account.shell.server';

function AccountLayoutFallback() {
  return (
    <div className="bg-background flex min-h-svh w-full flex-col">
      <div className="bg-muted/30 h-14 w-full animate-pulse" />
      <div className="flex min-h-0 flex-1">
        <div className="bg-muted/20 w-56 shrink-0 animate-pulse" />
        <div className="flex-1 p-6">
          <div className="bg-muted/50 mx-auto h-96 max-w-5xl animate-pulse rounded-xl" />
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
