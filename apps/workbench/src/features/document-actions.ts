/**
 * @file What the explorer and the palette can do to a document, over the
 * app's ports.
 *
 * The conversion between markdown and the tree needs the headless editor and
 * its transformers — the editor's weight — so those modules are loaded on
 * first use rather than with the app, the same way the editor pane is. That
 * load, like the conversion itself, can fail; every failure here ends as one
 * reported error, never as a rejection behind the `void` a menu item puts in
 * front of it.
 */
import type { DocumentActions } from '@workspace/workbench-files';
import type { AppServices } from '../composition/services';
import type { LiveDocuments } from './live-documents';

export type DocumentActionDeps = {
  services: Pick<
    AppServices,
    'documents' | 'files' | 'identity' | 'reportError'
  >;
  /** The documents editors hold open — what an export reads first. */
  live: LiveDocuments;
  loadMarkdown: () => Promise<typeof import('./document-markdown')>;
  loadDownload: () => Promise<typeof import('./download')>;
};

export type WorkbenchDocumentActions = DocumentActions & {
  exportMarkdown: (documentId: string) => Promise<void>;
};

export function createDocumentActions(
  deps: DocumentActionDeps
): WorkbenchDocumentActions {
  const { services, live } = deps;
  const failed = (error: unknown): void =>
    services.reportError(
      error instanceof Error ? error.message : String(error)
    );

  return {
    // A document is created through the document port and opened by the
    // file node the port lists it under — the explorer resolves the node.
    async create({ title, parentId }) {
      const result = await services.documents.create({ title, parentId });
      if (result.isErr()) {
        services.reportError(result.error);
        return null;
      }
      return { id: result.value.id };
    },

    async importMarkdown(input) {
      try {
        const { importMarkdownDocument } = await deps.loadMarkdown();
        const result = await importMarkdownDocument(
          { documents: services.documents, files: services.files },
          { user: services.identity.userId, src: 'human' },
          input
        );
        if (result.isErr()) {
          services.reportError(result.error);
          return null;
        }
        return { id: result.value.id };
      } catch (error) {
        failed(error);
        return null;
      }
    },

    async exportMarkdown(documentId) {
      try {
        const [{ exportDocumentMarkdown }, { downloadText }] =
          await Promise.all([deps.loadMarkdown(), deps.loadDownload()]);
        const result = await exportDocumentMarkdown(
          services.documents,
          documentId,
          live
        );
        if (result.isErr()) {
          services.reportError(result.error);
          return;
        }
        downloadText(
          `${result.value.title}.md`,
          result.value.markdown,
          'text/markdown'
        );
      } catch (error) {
        failed(error);
      }
    },
  };
}
