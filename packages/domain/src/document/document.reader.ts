import type { Unsubscribe } from '../shared/subscription.js';
import type { DocumentMeta, SerializedTree } from './document.do.js';

/**
 * Port: the reactive read side of the document list.
 *
 * `watch*` delivers the current rows immediately and again on every change,
 * until the returned unsubscribe is called. Kept framework-free: bridging a
 * subscription into a UI signal is the adapter package's `./solid` concern.
 */
export interface IDocumentListReader {
  watchRecent(cb: (docs: DocumentMeta[]) => void): Unsubscribe;
  /**
   * The document's derived content, now and on every save, with the writer
   * that produced it. This is how one client's open editor learns that
   * another client — a second tab, the agent — changed the document.
   */
  watchContent(
    documentId: string,
    cb: (content: { tree: SerializedTree; writer: string | null }) => void
  ): Unsubscribe;
}
