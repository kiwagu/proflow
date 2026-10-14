import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { WriteScope } from '@workspace/knowledge-contracts';
import type { WriteScopeStore } from './write-scope';
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

/** A host that wires no scope (a spec, a stand-alone surface) gives no hint. */
const NO_SCOPE: WriteScopeStore = {
  current: () => null,
  subscribe: () => () => {},
  accept: () => {},
};

/** The write scope, live: a component re-renders when a session check changes it. */
export function useWriteScope(): WriteScope | null {
  const store = useServices().writeScope ?? NO_SCOPE;
  return useSyncExternalStore(store.subscribe, store.current, store.current);
}
