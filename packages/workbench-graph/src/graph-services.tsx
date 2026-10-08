'use client';

import type {
  GraphReader,
  GraphRepository,
} from '@workspace/persistence-pglite';
import { createContext, useContext, type ReactNode } from 'react';
import type { SearchProvider } from './search-provider.js';

/**
 * The ports the graph workbench surface reads and writes through.
 *
 * Only ports, never a concrete store: the same hooks and components run over
 * the local database in the app and over a test database in a spec, and the
 * surface cannot tell the difference. There is no fetch anywhere behind this
 * seam — every read is a local live query and every write is a local write
 * plus its journal entry, which is what makes the surface work offline.
 */
export interface GraphServices {
  /** The live read vocabulary: nodes, edges, tags, satellites, user state. */
  graph: GraphReader;
  /** Structural commands — every one journals its op for the sync worker. */
  commands: GraphRepository;
  /** The space the surface is browsing. */
  spaceId: string;
  /** The signed-in user, for the rows that are per-user (star, progress). */
  userId: string;
  /**
   * Content search over what the device holds — the local hybrid engine
   * (vector + full text, rank-fused). Optional: a host without an embedder
   * (a test harness, a surface that never indexes) simply has no search
   * lens, and the surface must not crash for it. See `search-provider.ts`
   * for how a server engine would plug in here later.
   */
  search?: SearchProvider;
  /**
   * Where a failure the user caused is reported. The surface never throws at
   * them and never swallows: a host without a toaster still gets told. A
   * failure that can be repeated carries its retry, which resolves true once
   * the operation went through.
   */
  onError?: (message: string, options?: GraphErrorOptions) => void;
}

export type GraphErrorOptions = {
  /** One notice per key: a later report replaces the earlier one. */
  key?: string;
  retry?: () => Promise<boolean>;
};

const GraphServicesContext = createContext<GraphServices | null>(null);

export function GraphServicesProvider(props: {
  services: GraphServices;
  children: ReactNode;
}) {
  return (
    <GraphServicesContext.Provider value={props.services}>
      {props.children}
    </GraphServicesContext.Provider>
  );
}

export function useGraphServices(): GraphServices {
  const services = useContext(GraphServicesContext);
  if (!services) {
    throw new Error(
      'useGraphServices must be used within <GraphServicesProvider />'
    );
  }
  return services;
}

// Narrow accessors so a component depends on one port, not the whole bag.
export const useGraphReader = () => useGraphServices().graph;
export const useGraphCommands = () => useGraphServices().commands;
export const useSpaceId = () => useGraphServices().spaceId;
export const useCurrentUserId = () => useGraphServices().userId;
/** The content search engine, or null when the host wired none. */
export const useSearchProvider = () => useGraphServices().search ?? null;

/** Reports a failure to the host, if it asked to hear about them. */
export function useReportGraphError(): (
  message: string,
  options?: GraphErrorOptions
) => void {
  const { onError } = useGraphServices();
  return (message, options) => onError?.(message, options);
}
