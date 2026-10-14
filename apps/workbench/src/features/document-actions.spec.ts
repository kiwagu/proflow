/**
 * The document actions the explorer and the palette call, over the ports
 * and over the lazily loaded conversion modules.
 *
 * What matters here is the failure path: a module that cannot load (offline,
 * a stale deploy) or a converter that throws must reach the user as one
 * reported error and never as an unhandled rejection behind a `void`.
 */
import { entityIdRegistry } from '@workspace/entity-id';
import type {
  IDocumentRepository,
  IFileRepository,
  SerializedTree,
} from '@workspace/domain';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentActions,
  type DocumentActionDeps,
} from './document-actions';
import * as markdown from './document-markdown';
import { createLiveDocuments } from './live-documents';

const SPACE = entityIdRegistry.factories.spaceIdFactory.brand('space-1');

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
    identity: { userId: 'user-1', spaceId: SPACE },
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

  it('reports a reader that threw while taking the snapshot', async () => {
    const live = createLiveDocuments();
    live.register('doc-1', () => {
      throw new Error('snapshot failed');
    });
    const h = harness({ live });
    await expect(h.actions.exportMarkdown('doc-1')).resolves.toBeUndefined();
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]?.[0]).toContain('snapshot failed');
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

describe('the export snapshot belongs to the moment the user asked', () => {
  const tree = (text: string): SerializedTree =>
    markdownToState(text).state as unknown as SerializedTree;

  /** A port whose written content is `# Old`, and a loader we release by hand. */
  function raceHarness() {
    const live = createLiveDocuments();
    const downloadText = vi.fn();
    const reportError = vi.fn();
    let releaseLoader: () => void = () => {};
    const loaderReleased = new Promise<void>((resolve) => {
      releaseLoader = resolve;
    });
    const services: DocumentActionDeps['services'] = {
      documents: {
        writer: 'test',
        load: async () =>
          ok({
            meta: {
              id: 'doc-1',
              title: 'note',
              kind: 'md',
              preview: '',
              starred: false,
              createdAt: new Date(0),
              updatedAt: new Date(0),
            },
            content: { tree: tree('# Old'), markdown: '# Old' },
          }),
      } as unknown as IDocumentRepository,
      files: {} as unknown as IFileRepository,
      identity: { userId: 'user-1', spaceId: SPACE },
      reportError,
    };
    const actions = createDocumentActions({
      services,
      live,
      // The real converter, behind a loader that waits for the test.
      loadMarkdown: () => loaderReleased.then(() => markdown),
      loadDownload: async () => ({ downloadText }) as unknown as Download,
    });
    return { actions, live, downloadText, reportError, releaseLoader };
  }

  it('exports what the editor showed when the command ran, even if the editor closed meanwhile', async () => {
    const h = raceHarness();
    const release = h.live.register('doc-1', () => tree('# New words'));

    const exporting = h.actions.exportMarkdown('doc-1');
    // The user switches documents while the conversion module is loading:
    // the editor unmounts and lets go of its reader. The save of `# New
    // words` is still in flight, so the port knows only `# Old`.
    release();
    h.releaseLoader();
    await exporting;

    const [, text] = h.downloadText.mock.calls[0] ?? [];
    expect(text).toContain('# New words');
    expect(text).not.toContain('# Old');
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('falls back to the port when nothing was open at the moment of asking', async () => {
    const h = raceHarness();
    const exporting = h.actions.exportMarkdown('doc-1');
    // An editor opening AFTER the command must not change what this export
    // is about either.
    h.live.register('doc-1', () => tree('# Later'));
    h.releaseLoader();
    await exporting;

    const [, text] = h.downloadText.mock.calls[0] ?? [];
    expect(text).toContain('# Old');
    expect(text).not.toContain('# Later');
  });
});
