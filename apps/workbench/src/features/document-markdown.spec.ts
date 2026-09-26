/**
 * Markdown in and out of the document port, headlessly.
 *
 * Import is judged by what gets SAVED — the tree the editor will mount — and
 * export by the text a foreign reader receives: portable markdown, with no
 * internal tag leaking through.
 */
import type {
  DocumentMeta,
  IDocumentRepository,
  IFileRepository,
  SerializedNode,
  SerializedTree,
} from '@workspace/domain';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  exportDocumentMarkdown,
  importMarkdownDocument,
} from './document-markdown';

const AUTHOR = { user: 'tester', src: 'human' as const };
const MENTION =
  '<x-resource>{"resourceId":"knr_1","kind":"document","label":"Spec","display":"inline"}</x-resource>';

function meta(id: string, title: string): DocumentMeta {
  return {
    id,
    title,
    kind: 'md',
    preview: '',
    starred: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** The ports in memory: they record what they were asked, and serve one document. */
function fakeRepository(
  options: {
    content?: SerializedTree;
    saveFails?: string;
    loadFails?: string;
    nodeDeleteFails?: string;
  } = {}
) {
  const saved: Parameters<IDocumentRepository['save']>[0][] = [];
  const created: NonNullable<Parameters<IDocumentRepository['create']>[0]>[] =
    [];
  const documentDeletes: string[] = [];
  const nodeDeletes: string[] = [];
  const repository: IDocumentRepository = {
    writer: 'test',
    invalidate: () => {},
    create: vi.fn(async (input) => {
      created.push(input ?? {});
      return ok(meta('doc-1', input?.title ?? ''));
    }),
    load: vi.fn(async (id) =>
      options.loadFails
        ? err(options.loadFails)
        : ok({
            meta: meta(id, 'note'),
            content: options.content
              ? { tree: options.content, markdown: '' }
              : null,
          })
    ),
    save: vi.fn(async (input) => {
      if (options.saveFails) return err(options.saveFails);
      saved.push(input);
      return ok(true);
    }),
    rename: async () => ok(undefined),
    softDelete: vi.fn(async (id) => {
      documentDeletes.push(id);
      return ok(undefined);
    }),
  };
  const files = {
    softDelete: vi.fn(async (id: string) => {
      nodeDeletes.push(id);
      return options.nodeDeleteFails
        ? err(options.nodeDeleteFails)
        : ok(undefined);
    }),
  } as unknown as IFileRepository;
  return { repository, files, saved, created, documentDeletes, nodeDeletes };
}

/** No editor holds anything open. */
const NOTHING_OPEN = { read: () => null };

/** Every node of the tree, depth first. */
function nodesOf(node: SerializedNode): SerializedNode[] {
  return [node, ...(node.children ?? []).flatMap(nodesOf)];
}

describe('importing markdown as a document', () => {
  it('saves a tree carrying the markdown structure under the given title', async () => {
    const { repository, files, saved } = fakeRepository();

    const result = await importMarkdownDocument(
      { documents: repository, files },
      AUTHOR,
      {
        name: 'note',
        text: '# Title\n\nPara **bold**',
        parentId: 'folder-1',
      }
    );

    expect(result.isOk() && result.value).toEqual({ id: 'doc-1' });
    // The importer names the node it creates, so it can take it back.
    expect(repository.create).toHaveBeenCalledWith({
      title: 'note',
      parentId: 'folder-1',
      nodeId: expect.stringMatching(/^knr_/) as string,
    });
    const [write] = saved;
    expect(write?.id).toBe('doc-1');
    expect(write?.author).toEqual(AUTHOR);
    const blocks = write?.tree.root.children ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph']);
    const bold = nodesOf(write!.tree.root).find((n) => n.text === 'bold');
    expect(bold?.format).toBe(1);
    expect(write?.markdown).toContain('# Title');
    expect(write?.preview).toContain('Title');
  });

  it('reads the internal mention form as well as the portable one', async () => {
    const { repository, files, saved } = fakeRepository();

    await importMarkdownDocument({ documents: repository, files }, AUTHOR, {
      name: 'note',
      text: `${MENTION}\n\nsee [Plan](resource://knr_2)`,
      parentId: null,
    });

    const mentioned = nodesOf(saved[0]!.tree.root)
      .map((n) => n.resourceId)
      .filter(Boolean);
    expect(mentioned).toEqual(['knr_1', 'knr_2']);
  });

  it('takes the document back when its content cannot be written', async () => {
    const { repository, files, nodeDeletes, documentDeletes, created } =
      fakeRepository({ saveFails: 'disk is full' });

    const result = await importMarkdownDocument(
      { documents: repository, files },
      AUTHOR,
      {
        name: 'note',
        text: '# Hi',
        parentId: null,
      }
    );

    expect(result.isErr() && result.error).toBe('disk is full');
    // The explorer lists graph nodes, not document rows: only taking the
    // node back removes the shell from the tree, so the importer must know
    // the node's id — it handed it to `create` itself.
    const nodeId = created[0]?.nodeId;
    expect(nodeId).toMatch(/^knr_/);
    expect(nodeDeletes).toEqual([nodeId]);
    expect(documentDeletes).toEqual([]);
  });

  it('says so when the empty document could not be taken back either', async () => {
    const { repository, files } = fakeRepository({
      saveFails: 'disk is full',
      nodeDeleteFails: 'locked',
    });

    const result = await importMarkdownDocument(
      { documents: repository, files },
      AUTHOR,
      { name: 'note', text: '# Hi', parentId: null }
    );

    expect(result.isErr()).toBe(true);
    const reason = result.isErr() ? result.error : '';
    expect(reason).toContain('disk is full');
    expect(reason).toContain('locked');
  });
});

describe('exporting a document as portable markdown', () => {
  it('exports what the open editor holds, not the last written state', async () => {
    // The port lags the editor by a debounce, an in-flight write and its
    // retry; the user exports what they see.
    const written = markdownToState('# Old').state as unknown as SerializedTree;
    const held = markdownToState('# New words')
      .state as unknown as SerializedTree;
    const { repository } = fakeRepository({ content: written });

    const result = await exportDocumentMarkdown(repository, 'doc-1', {
      read: (id) => (id === 'doc-1' ? held : null),
    });

    const exported = result.isOk() ? result.value : null;
    expect(exported?.markdown).toContain('# New words');
    expect(exported?.markdown).not.toContain('# Old');
  });

  it('falls back to the written state for a document no editor holds', async () => {
    const written = markdownToState('# Old').state as unknown as SerializedTree;
    const { repository } = fakeRepository({ content: written });

    const result = await exportDocumentMarkdown(
      repository,
      'doc-1',
      NOTHING_OPEN
    );

    expect(result.isOk() ? result.value.markdown : '').toContain('# Old');
  });

  it('renders an own node in its portable form, never its internal tag', async () => {
    const content = markdownToState(MENTION).state as unknown as SerializedTree;
    const { repository } = fakeRepository({ content });

    const result = await exportDocumentMarkdown(
      repository,
      'doc-1',
      NOTHING_OPEN
    );

    expect(result.isOk()).toBe(true);
    const exported = result.isOk() ? result.value : null;
    expect(exported?.title).toBe('note');
    expect(exported?.markdown).toContain('[Spec](resource://knr_1)');
    expect(exported?.markdown).not.toContain('<x-resource');
  });

  it('reports a document that cannot be read', async () => {
    const { repository } = fakeRepository({ loadFails: 'gone' });

    const result = await exportDocumentMarkdown(
      repository,
      'doc-1',
      NOTHING_OPEN
    );

    expect(result.isErr() && result.error).toBe('gone');
  });
});
