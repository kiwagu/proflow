import type {
  IBlobStore,
  IChatListReader,
  IChatMessageRepository,
  IChatRepository,
  IDocumentListReader,
  IDocumentRepository,
  IDocumentVersionStore,
  IFileRepository,
  IFileTreeReader,
  IPackageReader,
  IPackageRepository,
  ISettingsStore,
  IStorageMaintenance,
} from '@workspace/domain';
import type {
  AppDb,
  DocumentChanged,
  DocumentCrdtStore,
  GraphReader,
  GraphRepository,
} from '@workspace/persistence-pglite';
import type { LiveDocuments } from '../features/live-documents';
import type { ReportError } from '../shell/operation-errors';

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
  /** The CRDT store itself, for the replication the composition root starts. */
  documentCrdt: DocumentCrdtStore;
  /** What the open editors hold: announced by the pane, read by the store before a merge. */
  liveDocuments: LiveDocuments;
  /** Every save, restore and remote merge, for the surface showing a document. */
  documentChanges: {
    onChanged(listener: (event: DocumentChanged) => void): () => void;
  };
  files: IFileRepository;
  fileTree: IFileTreeReader;
  blobs: IBlobStore & { persisted: boolean };
  packages: IPackageRepository;
  packageList: IPackageReader;
  settings: ISettingsStore;
  storageMaintenance: IStorageMaintenance;
  graph: GraphReader;
  graphCommands: GraphRepository;
  /** The assistant's conversations: the chats, their list, their messages. */
  chats: IChatRepository;
  chatList: IChatListReader;
  chatMessages: IChatMessageRepository;
  /** Server-verified session and checked-out space. */
  identity: { userId: string; spaceId: string };
  /**
   * Where a failure is reported so the user sees it. A report under a key
   * replaces the earlier one under that key; `resolveError` withdraws it
   * once the operation has gone through after all.
   */
  reportError: ReportError;
  resolveError: (key: string) => void;
}
