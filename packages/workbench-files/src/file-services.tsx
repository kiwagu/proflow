'use client';

import type {
  IBlobStore,
  IFileRepository,
  IFileTreeReader,
  IPackageReader,
  IPackageRepository,
} from '@workspace/domain';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * The ports the files surface reads and writes through.
 *
 * Only ports, never a concrete store: the same components run over the
 * local database in the app and over in-memory doubles in a test, and the
 * surface cannot tell the difference. Everything optional is a capability
 * the host may not have wired yet — the UI degrades by hiding the
 * affordance rather than by failing.
 */
export interface FileServices {
  /** Commands on the tree: create, import, rename, move, star, delete. */
  files: IFileRepository;
  /** The live tree: every node, flat, on every change. */
  fileTree: IFileTreeReader;
  /** Content-addressed bytes, for previewing and downloading a file. */
  blobs: Pick<IBlobStore, 'get'>;
  /** Archives that have been unpacked; absent when packages are not wired. */
  packages?: Pick<IPackageRepository, 'importArchive' | 'discardUnpacked'>;
  packageList?: IPackageReader;
  /**
   * Where a failure the user caused is reported. The surface never throws
   * at them and never swallows: a host without a toaster still gets told.
   */
  onError?: (message: string) => void;
}

const FileServicesContext = createContext<FileServices | null>(null);

export function FileServicesProvider(props: {
  services: FileServices;
  children: ReactNode;
}) {
  return (
    <FileServicesContext.Provider value={props.services}>
      {props.children}
    </FileServicesContext.Provider>
  );
}

export function useFileServices(): FileServices {
  const services = useContext(FileServicesContext);
  if (!services)
    throw new Error(
      'useFileServices must be used within <FileServicesProvider />'
    );
  return services;
}

// Narrow accessors so a component depends on one port, not the whole bag.
export const useFiles = () => useFileServices().files;
export const useFileTree = () => useFileServices().fileTree;
export const useBlobs = () => useFileServices().blobs;
export const usePackages = () => useFileServices().packages;
export const usePackageList = () => useFileServices().packageList;

/** Reports a failure to the host, if it asked to hear about them. */
export function useReportError(): (message: string) => void {
  const { onError } = useFileServices();
  return (message: string) => onError?.(message);
}
