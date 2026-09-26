/**
 * The document actions the explorer and the palette call, over the ports
 * and over the lazily loaded conversion modules.
 *
 * What matters here is the failure path: a module that cannot load (offline,
 * a stale deploy) or a converter that throws must reach the user as one
 * reported error and never as an unhandled rejection behind a `void`.
 */
import type { IDocumentRepository, IFileRepository } from '@workspace/domain';
import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentActions,
  type DocumentActionDeps,
} from './document-actions';
import { createLiveDocuments } from './live-documents';

type Markdown = Awaited<ReturnType<DocumentActionDeps['loadMarkdown']>>;
type Download = Awaited<ReturnType<DocumentActionDeps['loadDownload']>>;

function harness(overrides: Partial<DocumentActionDeps> = {}) {
  const reportError = vi.fn();
  const downloadText = vi.fn();
  const exportDocumentMarkdown = vi.fn<
    () => Promise<Result<{ title: string; markdown: string }, string>>
  >(async () => ok({ title: 'note', markdown: '# Hi' }));
  const importMarkdownDocument = vi.fn<
    () => Promise<Result<{ id: string }, string>>
  >(async () => ok({ id: 'doc-1' }));
  const services: DocumentActionDeps['services'] = {
    documents: { writer: 'test' } as unknown as IDocumentRepository,
    files: {} as unknown as IFileRepository,
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError,
  };
  const actions = createDocumentActions({
    services,
    live: createLiveDocuments(),
    loadMarkdown: async () =>
      ({
        exportDocumentMarkdown,
        importMarkdownDocument,
      }) as unknown as Markdown,
    loadDownload: async () => ({ downloadText }) as unknown as Download,
    ...overrides,
  });
  return {
    actions,
    services,
    reportError,
    downloadText,
    exportDocumentMarkdown,
    importMarkdownDocument,
  };
}

describe('exporting through the document actions', () => {
  it('downloads the portable markdown under the document title', async () => {
    const h = harness();
    await h.actions.exportMarkdown('doc-1');
    expect(h.downloadText).toHaveBeenCalledWith(
      'note.md',
      '# Hi',
      'text/markdown'
    );
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('reports a conversion module that failed to load, once, and downloads nothing', async () => {
    const h = harness({
      loadMarkdown: () => Promise.reject(new Error('chunk 503')),
    });
    await expect(h.actions.exportMarkdown('doc-1')).resolves.toBeUndefined();
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]?.[0]).toContain('chunk 503');
    expect(h.downloadText).not.toHaveBeenCalled();
  });

  it('reports a converter that threw instead of letting the rejection escape', async () => {
    const h = harness();
    h.exportDocumentMarkdown.mockImplementationOnce(async () => {
      throw new Error('bad tree');
    });
    await expect(h.actions.exportMarkdown('doc-1')).resolves.toBeUndefined();
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]?.[0]).toContain('bad tree');
    expect(h.downloadText).not.toHaveBeenCalled();
  });

  it('reports an export the port refused', async () => {
    const h = harness();
    h.exportDocumentMarkdown.mockImplementationOnce(async () => err('gone'));
    await h.actions.exportMarkdown('doc-1');
    expect(h.reportError).toHaveBeenCalledWith('gone');
    expect(h.downloadText).not.toHaveBeenCalled();
  });
});

describe('importing through the document actions', () => {
  it('imports as the signed-in author through both ports and hands back the id', async () => {
    const h = harness();
    const created = await h.actions.importMarkdown!({
      name: 'note',
      text: '# Hi',
      parentId: null,
    });
    expect(created).toEqual({ id: 'doc-1' });
    expect(h.importMarkdownDocument).toHaveBeenCalledWith(
      { documents: h.services.documents, files: h.services.files },
      { user: 'user-1', src: 'human' },
      { name: 'note', text: '# Hi', parentId: null }
    );
  });

  it('reports a refused import and answers with nothing', async () => {
    const h = harness();
    h.importMarkdownDocument.mockImplementationOnce(async () => err('no room'));
    const created = await h.actions.importMarkdown!({
      name: 'note',
      text: '# Hi',
      parentId: null,
    });
    expect(created).toBeNull();
    expect(h.reportError).toHaveBeenCalledWith('no room');
  });

  it('reports a module that failed to load instead of throwing into the explorer', async () => {
    const h = harness({
      loadMarkdown: () => Promise.reject(new Error('chunk 503')),
    });
    await expect(
      h.actions.importMarkdown!({ name: 'note', text: '# Hi', parentId: null })
    ).resolves.toBeNull();
    expect(h.reportError).toHaveBeenCalledTimes(1);
  });
});
