'use client';

import { createContext, useContext } from 'react';

const ActiveSpaceContext = createContext<string | null>(null);

export function ActiveSpaceProvider({
  children,
  activeSpaceId,
}: {
  children: React.ReactNode;
  activeSpaceId: string | null;
}) {
  return (
    <ActiveSpaceContext.Provider value={activeSpaceId}>
      {children}
    </ActiveSpaceContext.Provider>
  );
}

/** Returns the active space ID from the nearest ActiveSpaceProvider. */
export function useActiveSpaceId(): string | null {
  return useContext(ActiveSpaceContext);
}
