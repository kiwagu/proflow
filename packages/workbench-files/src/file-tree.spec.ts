import type { FileNode } from '@workspace/domain';
import { describe, expect, it } from 'vitest';
import {
  buildTree,
  categoryOf,
  formatSize,
  moveTargetsFor,
  type PendingImport,
  pendingToShow,
  type TreeItem,
} from './file-tree.js';

const node = (partial: Partial<FileNode> & { id: string }): FileNode => ({
  parentId: null,
  kind: 'blob',
  name: partial.id,
  mime: 'application/zip',
  size: 1,
  blobHash: 'h',
  documentId: null,
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...partial,
});

const importing = (id: string, name: string): PendingImport => ({
  id,
  name,
  parentId: null,
  progress: 1,
});

describe('placeholders for files being imported', () => {
  it('shows a file whose node has not arrived yet', () => {
    const pending = [importing('fil-1', 'course.zip')];
    expect(pendingToShow(pending, [])).toEqual(pending);
    expect(pendingToShow(pending, [node({ id: 'other' })])).toEqual(pending);
  });

  it('stops showing it the moment the tree delivers that node', () => {
    // The row is committed — and delivered — before the import call
    // returns. A placeholder that outlived it would stand beside the real
    // row: the same file listed twice.
    const pending = [importing('fil-1', 'course.zip')];
    const arrived = [node({ id: 'fil-1', name: 'course.zip' })];
    expect(pendingToShow(pending, arrived)).toEqual([]);
  });

  it('keeps the placeholders of the other files in the same batch', () => {
    const pending = [importing('fil-1', 'a.zip'), importing('fil-2', 'b.zip')];
    expect(
      pendingToShow(pending, [node({ id: 'fil-1', name: 'a.zip' })]).map(
        (file) => file.name
      )
    ).toEqual(['b.zip']);
  });
});

describe('building the tree', () => {
  const stored = () => [
    node({ id: 'folder', kind: 'folder', name: 'First', mime: null }),
    node({ id: 'child', name: 'course.zip', parentId: 'folder' }),
    node({ id: 'apple', name: 'apple.zip' }),
    node({ id: 'zebra', name: 'zebra.zip' }),
  ];
  const names = (items: TreeItem[]) =>
    items.map((item) =>
      item.row === 'node' ? item.node.name : item.file.name
    );

  it('nests children under their folder and leaves files alone', () => {
    const tree = buildTree(stored());
    expect(names(tree)).toEqual(['First', 'apple.zip', 'zebra.zip']);
    const folder = tree[0];
    expect(folder?.row === 'node' && names(folder.children)).toEqual([
      'course.zip',
    ]);
  });

  it('lists a file being imported where it will stay, not at the end', () => {
    // The row must not appear at the bottom and then jump: to the reader a
    // file sorts after the folders and by name, and so must its placeholder.
    const tree = buildTree(stored(), [importing('fil-1', 'middle.zip')]);
    expect(names(tree)).toEqual([
      'First',
      'apple.zip',
      'middle.zip',
      'zebra.zip',
    ]);
    expect(tree[2]?.row).toBe('importing');
  });

  it('never lists an imported file before the folders', () => {
    const tree = buildTree(stored(), [importing('fil-1', 'aaa.zip')]);
    expect(names(tree)).toEqual(['First', 'aaa.zip', 'apple.zip', 'zebra.zip']);
  });

  it('puts it inside the folder it is being imported into', () => {
    const inFolder: PendingImport = {
      ...importing('fil-1', 'alpha.zip'),
      parentId: 'folder',
    };
    const folder = buildTree(stored(), [inFolder])[0];
    expect(folder?.row === 'node' && names(folder.children)).toEqual([
      'alpha.zip',
      'course.zip',
    ]);
  });
});

describe('move targets', () => {
  const stored = () => [
    node({ id: 'outer', kind: 'folder', name: 'Outer', mime: null }),
    node({
      id: 'inner',
      kind: 'folder',
      name: 'Inner',
      mime: null,
      parentId: 'outer',
    }),
    node({ id: 'leaf', name: 'leaf.zip', parentId: 'inner' }),
  ];

  it('offers the root and every folder, indented by depth', () => {
    expect(moveTargetsFor(stored(), 'leaf')).toEqual([
      { id: null, name: 'Files', depth: 0 },
      { id: 'outer', name: 'Outer', depth: 1 },
      { id: 'inner', name: 'Inner', depth: 2 },
    ]);
  });

  it('never offers a folder to be moved into itself or below itself', () => {
    // Its descendants go with it, so either would detach the subtree from
    // the tree entirely — the walk stops at the excluded folder rather
    // than descending past it.
    expect(moveTargetsFor(stored(), 'outer').map((t) => t.id)).toEqual([null]);
  });
});

describe('reading a file from its MIME type', () => {
  it('maps the types the viewer renders natively', () => {
    expect(categoryOf('image/png')).toBe('image');
    expect(categoryOf('video/mp4')).toBe('video');
    expect(categoryOf('audio/mpeg')).toBe('audio');
    expect(categoryOf('application/pdf')).toBe('pdf');
    expect(categoryOf('text/markdown')).toBe('text');
    expect(categoryOf('application/json')).toBe('text');
    expect(categoryOf('application/zip')).toBe('archive');
  });

  it('falls back to unknown so the viewer offers a download', () => {
    expect(categoryOf(null)).toBe('unknown');
    expect(categoryOf('application/octet-stream')).toBe('unknown');
  });
});

describe('sizes', () => {
  it('reports decimal units, as the browser and the OS do', () => {
    expect(formatSize(999)).toBe('999 B');
    expect(formatSize(1000)).toBe('1.0 KB');
    expect(formatSize(15_000)).toBe('15 KB');
    expect(formatSize(2_500_000)).toBe('2.5 MB');
  });

  it('says nothing for a node that has no size', () => {
    expect(formatSize(null)).toBe('');
  });
});
