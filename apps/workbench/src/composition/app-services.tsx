import { createContext, useContext, type ReactNode } from 'react';
import type { AppServices } from './services';

const Ctx = createContext<AppServices | null>(null);

export function AppServicesProvider(props: {
  services: AppServices;
  children: ReactNode;
}) {
  return <Ctx.Provider value={props.services}>{props.children}</Ctx.Provider>;
}

export function useServices(): AppServices {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error('useServices must be used within <AppServicesProvider />');
  return ctx;
}

// Narrow accessors so a component depends on one port, not the whole bag.
export const useDocuments = () => useServices().documents;
export const useDocumentList = () => useServices().documentList;
export const useDocumentVersions = () => useServices().documentVersions;
export const useSettings = () => useServices().settings;
export const useReportError = () => useServices().reportError;
