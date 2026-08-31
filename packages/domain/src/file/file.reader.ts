import type { Unsubscribe } from '../shared/subscription.js';
import type { FileNode } from './file.do.js';

/**
 * Port: the reactive read side of the file tree.
 *
 * Delivers the WHOLE tree, flat, on every change. A local-first tree is
 * small enough that shaping it (parents, sorting, filtering by kind) is the
 * UI's job, and one subscription beats one per expanded folder.
 */
export interface IFileTreeReader {
  watchAll(cb: (nodes: FileNode[]) => void): Unsubscribe;
}
