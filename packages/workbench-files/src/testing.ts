import type { FileNode, Unsubscribe } from '@workspace/domain';
import { err, ok, type Result } from 'neverthrow';
import type { FileServices } from './file-services.js';

/**
 * A file node with everything filled in, so a test states only what the
 * case is about.
 */
export function testNode(
  partial: Partial<FileNode> & { id: string }
): FileNode {
  return {
    parentId: null,
    kind: 'blob',
    name: partial.id,
    mime: 'text/plain',
    size: 10,
    blobHash: 'hash-' + partial.id,
    documentId: null,
    starred: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  };
}

export interface FakeTree {
  services: FileServices;
  /** Delivers a new tree to every live subscriber, as the reader would. */
  deliver: (nodes: FileNode[]) => void;
  calls: {
    rename: Array<[string, string]>;
    move: Array<[string, string | null]>;
    star: Array<[string, boolean]>;
    deleted: string[];
    createdFolders: Array<{ parentId: string | null; name: string }>;
    imported: Array<{ name: string; parentId: string | null }>;
    unpacked: string[];
    errors: string[];
  };
}

/**
 * The ports, in memory: a live tree that can be pushed to, commands that
 * record what they were asked to do, and a blob store over plain bytes.
 *
 * The surface talks to ports only, so this is a complete stand-in — the
 * components under test cannot tell it from the local database.
 */
export function fakeServices(
  initial: FileNode[] = [],
  options: {
    blobs?: Record<string, Blob>;
    unpacked?: string[];
    importFails?: string;
  } = {}
): FakeTree {
  let nodes = initial;
  const subscribers = new Set<(nodes: FileNode[]) => void>();
  const calls: FakeTree['calls'] = {
    rename: [],
    move: [],
    star: [],
    deleted: [],
    createdFolders: [],
    imported: [],
    unpacked: [],
    errors: [],
  };

  const deliver = (next: FileNode[]) => {
    nodes = next;
    for (const cb of subscribers) cb(nodes);
  };

  const unsupported = <T>(): Promise<Result<T, string>> =>
    Promise.resolve(err('not wired in this test'));

  const services: FileServices = {
    fileTree: {
      watchAll(cb): Unsubscribe {
        subscribers.add(cb);
        cb(nodes);
        return () => subscribers.delete(cb);
      },
    },
    files: {
      createFolder({ parentId, name, id }) {
        calls.createdFolders.push({ parentId, name });
        const node = testNode({
          id: id ?? 'folder-' + calls.createdFolders.length,
          kind: 'folder',
          name,
          parentId,
          mime: null,
          size: null,
          blobHash: null,
        });
        deliver([...nodes, node]);
        return Promise.resolve(ok(node));
      },
      importFile({ parentId, name, id, onProgress }) {
        calls.imported.push({ name, parentId });
        onProgress?.(1, 2);
        if (options.importFails)
          return Promise.resolve(err(options.importFails));
        const node = testNode({
          id: id ?? 'imported-' + calls.imported.length,
          name,
          parentId,
        });
        deliver([...nodes, node]);
        return Promise.resolve(ok(node));
      },
      get: (id) => {
        const found = nodes.find((n) => n.id === id);
        return Promise.resolve(found ? ok(found) : err('no such node'));
      },
      findByBlob: (hash) =>
        Promise.resolve(ok(nodes.find((n) => n.blobHash === hash) ?? null)),
      rename(id, name) {
        calls.rename.push([id, name]);
        return Promise.resolve(ok(undefined));
      },
      move(id, parentId) {
        calls.move.push([id, parentId]);
        return Promise.resolve(ok(undefined));
      },
      setStarred(id, starred) {
        calls.star.push([id, starred]);
        return Promise.resolve(ok(undefined));
      },
      softDelete(id) {
        calls.deleted.push(id);
        return Promise.resolve(ok(undefined));
      },
      collectGarbage: () => unsupported<string[]>(),
    },
    blobs: {
      get: (hash) => Promise.resolve(options.blobs?.[hash] ?? null),
    },
    packages: {
      importArchive(hash) {
        calls.unpacked.push(hash);
        return Promise.resolve(
          ok({
            hash,
            kind: 'archive',
            manifest: { launchPath: '' },
            createdAt: new Date(0),
          })
        );
      },
      discardUnpacked: () => Promise.resolve(ok(undefined)),
    },
    packageList: {
      watchUnpacked(cb): Unsubscribe {
        cb(options.unpacked ?? []);
        return () => {};
      },
    },
    onError: (message) => calls.errors.push(message),
  };

  return { services, deliver, calls };
}
