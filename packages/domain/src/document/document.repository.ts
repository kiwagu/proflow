import type { Result } from 'neverthrow';
import type { EditAuthor } from '../shared/edit-author.vo.js';
import type {
  DocumentContent,
  DocumentKind,
  DocumentMeta,
  SerializedTree,
} from './document.do.js';

/**
 * Port: one-shot commands and reads on a single document.
 *
 * The reactive list side lives in a separate port (IDocumentListReader):
 * a live subscription has a lifetime and different failure modes than a
 * request/response call, so the two are not one interface.
 */
export interface IDocumentRepository {
  /**
   * This client's writer identity. Every tab and worker that can save is a
   * distinct writer; a client watching a document uses it to tell its own
   * saves from everyone else's.
   */
  readonly writer: string;
  /**
   * Drops any in-memory copy of the document, so the next read rebuilds it
   * from storage. Called after another writer's save has been applied —
   * the local copy is behind what the store now holds.
   */
  invalidate(id: string): void;
  /** Creates a document and its file node, under `parentId` (root when null). */
  create(input?: {
    kind?: DocumentKind;
    title?: string;
    parentId?: string | null;
    /** Ids to give the document and its file node; minted by the caller when it shows them first. */
    id?: string;
    nodeId?: string;
  }): Promise<Result<DocumentMeta, string>>;
  load(
    id: string
  ): Promise<
    Result<{ meta: DocumentMeta; content: DocumentContent | null }, string>
  >;
  /**
   * Records a new state of the document. Every save is attributed, because
   * attribution cannot be reconstructed after the fact.
   *
   * Resolves to whether anything changed: an idle save of an unchanged
   * document must not leave a mark on its history.
   */
  save(input: {
    id: string;
    tree: SerializedTree;
    markdown: string;
    preview: string;
    author: EditAuthor;
  }): Promise<Result<boolean, string>>;
  rename(id: string, title: string): Promise<Result<void, string>>;
  softDelete(id: string): Promise<Result<void, string>>;
}
