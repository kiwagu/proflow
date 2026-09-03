import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMeta } from '../chat/chat.do.js';
import { createOptimisticChats } from '../chat/chat.optimistic.js';
import type { IChatListReader } from '../chat/chat.reader.js';
import type { IChatRepository } from '../chat/chat.repository.js';
import type { DocumentMeta } from '../document/document.do.js';
import type { IDocumentListReader } from '../document/document.reader.js';
import type { IDocumentRepository } from '../document/document.repository.js';
import { createOptimisticEntities } from '../shared/optimistic.js';
import type { FileNode } from './file.do.js';
import {
  createOptimisticFiles,
  sortFileNodes,
  subtreeOf,
} from './file.optimistic.js';
import type { IFileRepository } from './file.repository.js';

const at = (ms: number) => new Date(2026, 0, 1, 0, 0, 0, ms);

function node(partial: Partial<FileNode> & { id: string }): FileNode {
  return {
    parentId: null,
    kind: 'blob',
    name: partial.id,
    mime: 'text/plain',
    size: 1,
    blobHash: 'h',
    documentId: null,
    starred: false,
    createdAt: at(0),
    updatedAt: at(0),
    ...partial,
  };
}

const tree = (): FileNode[] => [
  node({ id: 'docs', kind: 'folder', name: 'Docs', mime: null }),
  node({ id: 'a', name: 'a.txt', parentId: 'docs' }),
  node({ id: 'nested', kind: 'folder', name: 'Nested', parentId: 'docs' }),
  node({
    id: 'note',
    kind: 'document',
    name: 'Note',
    mime: null,
    blobHash: null,
    documentId: 'doc-1',
    parentId: 'nested',
  }),
  node({ id: 'z', name: 'z.txt' }),
];

const meta = (id: string, title: string): DocumentMeta => ({
  id,
  title,
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: at(0),
  updatedAt: at(0),
});

function harness() {
  let onTree: ((nodes: FileNode[]) => void) | undefined;
  let onDocuments: ((docs: DocumentMeta[]) => void) | undefined;
  const commands = {
    createFolder: vi.fn(async (input: { id?: string }) =>
      ok(node({ id: input.id ?? 'x' }))
    ),
    rename: vi.fn(async (): Promise<Result<void, string>> => ok(undefined)),
    move: vi.fn(async () => ok<void, string>(undefined)),
    setStarred: vi.fn(async () => ok<void, string>(undefined)),
    softDelete: vi.fn(async () => ok<void, string>(undefined)),
    create: vi.fn(async (input?: { id?: string; title?: string }) =>
      ok(meta(input?.id ?? 'doc-x', input?.title ?? ''))
    ),
  };
  const onError = vi.fn();
  const optimistic = createOptimisticFiles({
    entities: createOptimisticEntities(),
    files: commands as unknown as IFileRepository,
    documents: commands as unknown as IDocumentRepository,
    tree: {
      watchAll: (cb) => {
        onTree = cb;
        return () => {
          onTree = undefined;
        };
      },
    },
    documentList: {
      watchRecent: (cb) => {
        onDocuments = cb;
        return () => {
          onDocuments = undefined;
        };
      },
      watchContent: () => () => {},
    } as IDocumentListReader,
    onError,
  });
  const nodes: FileNode[][] = [];
  const documents: DocumentMeta[][] = [];
  optimistic.tree.watchAll((next) => nodes.push(next));
  optimistic.documentList.watchRecent((next) => documents.push(next));
  return {
    ...optimistic,
    commands,
    onError,
    nodes: () => nodes.at(-1) ?? [],
    documentRows: () => documents.at(-1) ?? [],
    documentHistory: documents,
    deliverTree: (next: FileNode[]) => onTree?.(sortFileNodes(next)),
    deliverDocuments: (next: DocumentMeta[]) => onDocuments?.(next),
  };
}

describe('file tree helpers', () => {
  it('orders folders first, then by name, then by age', () => {
    const sorted = sortFileNodes([
      node({ id: 'b', name: 'b.txt' }),
      node({ id: 'a', name: 'a.txt' }),
      node({ id: 'f', kind: 'folder', name: 'zzz', mime: null }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(['f', 'a', 'b']);
  });

  it('collects a folder with everything under it', () => {
    expect(subtreeOf(tree(), 'docs').sort()).toEqual([
      'a',
      'docs',
      'nested',
      'note',
    ]);
    expect(subtreeOf(tree(), 'z')).toEqual(['z']);
  });
});

describe('optimistic files', () => {
  it('shows a new folder before the write lands, with the id it will have', async () => {
    const h = harness();
    h.deliverTree(tree());

    const created = await h.files.createFolder({
      parentId: 'docs',
      name: 'Papers',
    });
    const id = created.isOk() ? created.value.id : '';
    expect(h.commands.createFolder).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'docs', name: 'Papers', id })
    );
    expect(h.nodes().find((n) => n.name === 'Papers')?.id).toBe(id);
    // A folder sorts before files, where the reader will put it.
    expect(
      h
        .nodes()
        .map((n) => n.name)
        .indexOf('Papers')
    ).toBeLessThan(
      h
        .nodes()
        .map((n) => n.name)
        .indexOf('a.txt')
    );
  });

  it('renames a document node in the tree and in the document list at once', async () => {
    const h = harness();
    h.deliverTree(tree());
    h.deliverDocuments([meta('doc-1', 'Note')]);

    await h.files.rename('note', 'Renamed');
    expect(h.nodes().find((n) => n.id === 'note')?.name).toBe('Renamed');
    expect(h.documentRows()[0]?.title).toBe('Renamed');

    // Both lift once their own source shows the change.
    h.deliverTree(
      tree().map((n) => (n.id === 'note' ? { ...n, name: 'Renamed' } : n))
    );
    h.deliverDocuments([meta('doc-1', 'Renamed')]);
    expect(h.nodes().find((n) => n.id === 'note')?.name).toBe('Renamed');
    expect(h.documentRows()[0]?.title).toBe('Renamed');
  });

  it('deletes a folder with its subtree, and the documents it held', async () => {
    const h = harness();
    h.deliverTree(tree());
    h.deliverDocuments([meta('doc-1', 'Note')]);

    await h.files.softDelete('docs');
    expect(h.nodes().map((n) => n.id)).toEqual(['z']);
    expect(h.documentRows()).toEqual([]);
  });

  it('creates a document as a tree row and a list row, sharing one command', async () => {
    const h = harness();
    h.deliverTree(tree());
    h.deliverDocuments([]);

    const created = await h.documents.create({
      title: 'Draft',
      parentId: 'docs',
    });
    const documentId = created.isOk() ? created.value.id : '';
    const call = h.commands.create.mock.calls[0]?.[0];
    expect(call?.id).toBe(documentId);
    expect((call as { nodeId?: string } | undefined)?.nodeId).toBeTruthy();

    const row = h.nodes().find((n) => n.documentId === documentId);
    expect(row?.kind).toBe('document');
    expect(row?.parentId).toBe('docs');
    expect(h.documentRows().map((d) => d.id)).toEqual([documentId]);
  });

  it('reports a failed command and shows the sources again', async () => {
    const h = harness();
    h.commands.rename.mockResolvedValueOnce(err('nope'));
    h.deliverTree(tree());
    h.deliverDocuments([meta('doc-1', 'Note')]);

    await h.files.rename('note', 'Renamed');
    expect(h.onError).toHaveBeenCalledWith('nope');
    expect(h.nodes().find((n) => n.id === 'note')?.name).toBe('Note');
    expect(h.documentRows()[0]?.title).toBe('Note');
  });
});

describe('optimistic chats', () => {
  function chatHarness() {
    let onChats: ((chats: ChatMeta[]) => void) | undefined;
    const create = vi.fn(
      async (name?: string, id?: string): Promise<Result<ChatMeta, string>> =>
        ok({
          id: id ?? 'cht-x',
          name: name ?? '',
          model: null,
          createdAt: at(0),
          updatedAt: at(0),
        })
    );
    const chats = { create } as unknown as IChatRepository;
    const optimistic = createOptimisticChats({
      entities: createOptimisticEntities(),
      chats,
      chatList: {
        watchRecent: (cb) => {
          onChats = cb;
          return () => {
            onChats = undefined;
          };
        },
      } as IChatListReader,
    });
    const seen: ChatMeta[][] = [];
    optimistic.chatList.watchRecent((next) => seen.push(next));
    return {
      ...optimistic,
      create,
      seen: () => seen.at(-1) ?? [],
      deliver: (next: ChatMeta[]) => onChats?.(next),
    };
  }

  it('shows a new chat immediately under the id the write will use', async () => {
    const h = chatHarness();
    h.deliver([]);
    const created = await h.chats.create('Research');
    const id = created.isOk() ? created.value.id : '';
    expect(h.create).toHaveBeenCalledWith('Research', id);
    expect(h.seen().map((c) => c.id)).toEqual([id]);
  });
});
