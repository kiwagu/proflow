import type { DocumentMeta } from '../document/document.do.js';
import type { IDocumentListReader } from '../document/document.reader.js';
import type { IDocumentRepository } from '../document/document.repository.js';
import { newId } from '../shared/id.js';
import {
  insertRow,
  type OptimisticEntities,
  patchRow,
  project,
  removeRows,
} from '../shared/optimistic.js';
import type { FileNode } from './file.do.js';
import type { IFileTreeReader } from './file.reader.js';
import type { IFileRepository } from './file.repository.js';

/** The file tree, under whatever query a surface reads it with. */
export const FILE_ENTITY = 'file';
/** Document metadata: the recent list, mentions, anything titled. */
export const DOCUMENT_ENTITY = 'document';

/**
 * The reader's order — folders first, then by name, then by age — so a
 * projected edit lands where the source will put it and nothing jumps
 * when the overlay lifts.
 */
export function sortFileNodes(nodes: readonly FileNode[]): FileNode[] {
  return [...nodes].sort(
    (a, b) =>
      Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/** A node and everything under it — what deleting a folder takes with it. */
export function subtreeOf(nodes: readonly FileNode[], id: string): string[] {
  const gone = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && gone.has(node.parentId) && !gone.has(node.id)) {
        gone.add(node.id);
        grew = true;
      }
    }
  }
  return [...gone];
}

const patchNode = (id: string, patch: Partial<FileNode>) =>
  project<FileNode>(FILE_ENTITY, patchRow<FileNode>(id, patch, sortFileNodes));

/**
 * Decorates the file and document ports so every edit shows at once.
 *
 * Same ports in, same ports out: whatever reads the tree or the document
 * list sees creations, renames, moves, stars and deletions the moment they
 * are asked for, and whatever commands through the repositories is
 * unchanged. Ids are minted here rather than in the adapter, which is what
 * makes a creation showable before the write lands. The overlay lifts when
 * the sources catch up, and a failed command simply disappears from view —
 * `onError` is where a surface learns that it did.
 */
export function createOptimisticFiles(deps: {
  entities: OptimisticEntities;
  files: IFileRepository;
  tree: IFileTreeReader;
  documents: IDocumentRepository;
  documentList: IDocumentListReader;
  onError?: (message: string) => void;
}): {
  files: IFileRepository;
  tree: IFileTreeReader;
  documents: IDocumentRepository;
  documentList: IDocumentListReader;
} {
  const tree = deps.entities.source<FileNode>(FILE_ENTITY, (cb) =>
    deps.tree.watchAll(cb)
  );
  const documentRows = deps.entities.source<DocumentMeta>(
    DOCUMENT_ENTITY,
    (cb) => deps.documentList.watchRecent(cb)
  );

  // What a command against a node means for the document that node stands
  // for — a rename is one write and two read models. Read from the tree as
  // it was last delivered, which is empty while nothing watches it: then
  // no surface is showing documents by title either, and the mirror has
  // nothing to be right about.
  const documentIdOf = (id: string) =>
    tree.rows().find((n) => n.id === id)?.documentId ?? null;

  const run = <T>(
    projections: Array<ReturnType<typeof project>>,
    command: () => Promise<import('neverthrow').Result<T, string>>
  ) =>
    deps.entities.run(projections, command).then((result) => {
      if (result.isErr()) deps.onError?.(result.error);
      return result;
    });

  const files: IFileRepository = {
    ...deps.files,

    createFolder(input) {
      const id = input.id ?? newId('fileNode');
      const at = new Date();
      return run(
        [
          project<FileNode>(
            FILE_ENTITY,
            insertRow<FileNode>(
              {
                id,
                parentId: input.parentId,
                kind: 'folder',
                name: input.name,
                mime: null,
                size: null,
                blobHash: null,
                documentId: null,
                starred: false,
                createdAt: at,
                updatedAt: at,
              },
              sortFileNodes
            )
          ),
        ],
        () => deps.files.createFolder({ ...input, id })
      );
    },

    rename(id, name) {
      const documentId = documentIdOf(id);
      return run(
        [
          patchNode(id, { name }),
          // A native document's name IS its title, in one write and in
          // every list that shows documents by title.
          ...(documentId
            ? [
                project<DocumentMeta>(
                  DOCUMENT_ENTITY,
                  patchRow<DocumentMeta>(documentId, { title: name })
                ),
              ]
            : []),
        ],
        () => deps.files.rename(id, name)
      );
    },

    move: (id, parentId) =>
      run([patchNode(id, { parentId })], () => deps.files.move(id, parentId)),

    setStarred(id, starred) {
      const documentId = documentIdOf(id);
      return run(
        [
          patchNode(id, { starred }),
          ...(documentId
            ? [
                project<DocumentMeta>(
                  DOCUMENT_ENTITY,
                  patchRow<DocumentMeta>(documentId, { starred })
                ),
              ]
            : []),
        ],
        () => deps.files.setStarred(id, starred)
      );
    },

    softDelete(id) {
      const documentIds = subtreeOf(tree.rows(), id)
        .map(documentIdOf)
        .filter((v): v is string => v !== null);
      return run(
        [
          project<FileNode>(
            FILE_ENTITY,
            removeRows<FileNode>((rows) => subtreeOf(rows, id))
          ),
          project<DocumentMeta>(
            DOCUMENT_ENTITY,
            removeRows<DocumentMeta>(() => documentIds)
          ),
        ],
        () => deps.files.softDelete(id)
      );
    },
  };

  const documents: IDocumentRepository = {
    ...deps.documents,

    create(input) {
      const id = input?.id ?? newId('document');
      const nodeId = input?.nodeId ?? newId('fileNode');
      const at = new Date();
      const title = input?.title ?? '';
      return run(
        [
          project<FileNode>(
            FILE_ENTITY,
            insertRow<FileNode>(
              {
                id: nodeId,
                parentId: input?.parentId ?? null,
                kind: 'document',
                name: title,
                mime: null,
                size: null,
                blobHash: null,
                documentId: id,
                starred: false,
                createdAt: at,
                updatedAt: at,
              },
              sortFileNodes
            )
          ),
          project<DocumentMeta>(
            DOCUMENT_ENTITY,
            insertRow<DocumentMeta>({
              id,
              title,
              kind: input?.kind ?? 'md',
              preview: '',
              starred: false,
              createdAt: at,
              updatedAt: at,
            })
          ),
        ],
        () => deps.documents.create({ ...input, id, nodeId })
      );
    },
  };

  return {
    files,
    documents,
    tree: { watchAll: tree.watch },
    documentList: { ...deps.documentList, watchRecent: documentRows.watch },
  };
}
