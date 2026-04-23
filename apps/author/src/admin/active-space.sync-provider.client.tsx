'use client';

import type { ReactNode } from 'react';

import { AuthorActiveSpaceSyncClient } from './active-space.sync.client';

type AuthorActiveSpaceSyncProviderClientProps = {
  children: ReactNode;
};

export default function AuthorActiveSpaceSyncProviderClient({
  children,
}: AuthorActiveSpaceSyncProviderClientProps) {
  return (
    <>
      <AuthorActiveSpaceSyncClient />
      {children}
    </>
  );
}
