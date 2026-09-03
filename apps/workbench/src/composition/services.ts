import type {
  IBlobStore,
  IDocumentListReader,
  IDocumentRepository,
  IDocumentVersionStore,
  IFileRepository,
  IFileTreeReader,
  IPackageReader,
  IPackageRepository,
  ISettingsStore,
} from '@workspace/domain';
import type {
  AppDb,
  GraphReader,
  GraphRepository,
} from '@workspace/persistence-pglite';

/**
 * Everything the workbench surfaces reach for, built once by the composition
 * root and handed down through context. Ports only: no surface imports an
 * adapter package, so the same components run over the local database here
 * and over doubles in their specs.
 */
export interface AppServices {
  db: AppDb;
  documents: IDocumentRepository;
  documentList: IDocumentListReader;
  documentVersions: IDocumentVersionStore;
  files: IFileRepository;
  fileTree: IFileTreeReader;
  blobs: IBlobStore & { persisted: boolean };
  packages: IPackageRepository;
  packageList: IPackageReader;
  settings: ISettingsStore;
  graph: GraphReader;
  graphCommands: GraphRepository;
  /** The identity the graph rows are written under until a session exists. */
  identity: { userId: string; spaceId: string };
  /** Where a failure the user caused is reported. */
  reportError: (message: string) => void;
}
