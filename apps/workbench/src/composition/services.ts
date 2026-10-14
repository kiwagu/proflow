import type { SpaceId } from '@workspace/entity-id';
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
  DocumentCrdtStore,
  DocumentPeers,
  GraphReader,
  GraphRepository,
} from '@workspace/persistence-pglite';
import type { DocumentChanges } from '../features/document-changes';
import type { LiveDocuments } from '../features/live-documents';
import type { ReportError } from '../shell/operation-errors';
import type { WriteScopeStore } from './write-scope';

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
  documentChanges: DocumentChanges;
  files: IFileRepository;
  fileTree: IFileTreeReader;
  blobs: IBlobStore & { persisted: boolean };
  packages: IPackageRepository;
  packageList: IPackageReader;
  settings: ISettingsStore;
  storageMaintenance: IStorageMaintenance;
  graph: GraphReader;
  graphCommands: GraphRepository;
  /** The other tabs of this browser, announcing documents they wrote. */
  documentPeers: DocumentPeers;
  /** Subscribes to graph writes reaching the journal, from any repository here. */
  onGraphJournaled(listener: () => void): () => void;
  /** The assistant's conversations: the chats, their list, their messages. */
  chats: IChatRepository;
  chatList: IChatListReader;
  chatMessages: IChatMessageRepository;
  /**
   * Server-verified session and checked-out space. The user is the auth
   * user UUID, not an entity id.
   */
  identity: { userId: string; spaceId: SpaceId };
  /** What the person may change in the space, as each session check restates it. */
  writeScope: WriteScopeStore;
  /**
   * Where a failure is reported so the user sees it. A report under a key
   * replaces the earlier one under that key; `resolveError` withdraws it
   * once the operation has gone through after all.
   */
  reportError: ReportError;
  resolveError: (key: string) => void;
}
