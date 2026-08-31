import {
  type DocumentMeta,
  type FileNode,
  type IDocumentRepository,
  type ISemanticSearch,
  LOCAL_USER_ID,
  type SerializedTree,
} from '@workspace/domain';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import { markdownToState } from '../editing/markdown';

/**
 * What the chat's document tools need from the application.
 *
 * Everything is a port or a plain function: the tools never see the
 * database, and the editing session is handed in as a capability so the
 * chat loop does not know which model or sandbox runs it.
 */
export interface DocumentToolDeps {
  documents: IDocumentRepository;
  /** One-shot listing for name lookups. */
  listDocuments: () => Promise<DocumentMeta[]>;
  /** One-shot snapshot of the whole file tree, flat. */
  listFiles: () => Promise<FileNode[]>;
  search: ISemanticSearch;
  /** Run an AI edit on a document and report the outcome for the model. */
  editDocument: (input: {
    documentId: string;
    instructions: string;
    signal?: AbortSignal;
  }) => Promise<{ summary: string; clarification?: string | null }>;
}

const notFound = (id: string) => `No document with id ${id}`;

/**
 * The tree as the model reads it: one entry per live node, addressed by a
 * `/`-rooted path built from the folder chain. A local-first tree is small,
 * so the whole listing in one response beats a directory-walking dialogue.
 */
export function toFileListing(nodes: readonly FileNode[]): Array<{
  path: string;
  kind: FileNode['kind'];
  id: string;
  documentId: string | null;
  mime: string | null;
  size: number | null;
}> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pathOf = (node: FileNode): string => {
    const parts: string[] = [];
    for (
      let cur: FileNode | undefined = node;
      cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    ) {
      parts.unshift(cur.name);
    }
    return `/${parts.join('/')}`;
  };
  return nodes.map((node) => ({
    path: pathOf(node),
    kind: node.kind,
    id: node.id,
    documentId: node.documentId,
    mime: node.mime,
    size: node.size,
  }));
}

/**
 * The document tools, named and shaped as the origin's service defines
 * them — `EditDocument` takes `document_id`, the rest `documentId` — so the
 * vendored tool renderers read the calls without translation.
 */
export function createDocumentTools(deps: DocumentToolDeps): ToolSet {
  return {
    ReadContent: tool({
      description:
        'Read the full content of a document by id. Call this before editing or quoting a document.',
      inputSchema: z.object({
        documentId: z
          .string()
          .describe('The id of the document you want to retrieve content for.'),
      }),
      execute: async ({ documentId }) => {
        const loaded = await deps.documents.load(documentId);
        if (loaded.isErr()) return { error: notFound(documentId) };
        return {
          content: { text: loaded.value.content?.markdown ?? '' },
          comments: [],
        };
      },
    }),

    ReadMetadata: tool({
      description:
        'Read a document’s metadata: name, file type and timestamps.',
      inputSchema: z.object({
        documentId: z
          .string()
          .describe(
            'The id of the document you want to retrieve metadata for.'
          ),
      }),
      execute: async ({ documentId }) => {
        const loaded = await deps.documents.load(documentId);
        if (loaded.isErr()) return { error: notFound(documentId) };
        const { meta } = loaded.value;
        return {
          documentMetadata: {
            documentId: meta.id,
            documentName: meta.title,
            fileType: meta.kind,
            createdAt: meta.createdAt.toISOString(),
            updatedAt: meta.updatedAt.toISOString(),
          },
          userAccessLevel: 'owner',
        };
      },
    }),

    ListFiles: tool({
      description:
        'List the user’s files and folders as stored in the app: every entry with its full path, kind (folder | document | blob), id, and for stored files the MIME type and byte size. Call this to see what exists or to find something by location; a `document` entry’s documentId works with ReadContent and the other document tools. Pass `path` to list only one folder’s subtree.',
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            'A folder path like /Projects/Notes to list only that subtree. Omit for the whole tree.'
          ),
      }),
      execute: async ({ path }) => {
        const listing = toFileListing(await deps.listFiles());
        if (!path || path === '/') return { entries: listing };
        const prefix = path.endsWith('/') ? path : `${path}/`;
        const entries = listing.filter(
          (entry) => entry.path === path || entry.path.startsWith(prefix)
        );
        return entries.length > 0
          ? { entries }
          : { entries: [], note: `Nothing under ${path}` };
      },
    }),

    ContentSearch: tool({
      description:
        'Search the user’s documents by content. Pass 1-3 keywords drawn from words that would literally appear in the content, not the user’s natural-language description.',
      inputSchema: z.object({
        query: z.string().describe('The text to search.'),
        matchType: z.enum(['prefix', 'exact']).optional(),
        entityTypes: z.array(z.string()).optional(),
      }),
      execute: async ({ query }) => {
        const hits = await deps.search.search(query, { limit: 8 });
        if (hits.isErr()) return { results: [] };
        return {
          results: hits.value.map((hit) => ({
            type: 'document' as const,
            id: hit.documentId,
            name: hit.title,
            document_id: hit.documentId,
            document_name: hit.title,
            file_type: 'md',
            document_search_results: [
              { raw_content: hit.excerpt, score: hit.score },
            ],
          })),
        };
      },
    }),

    NameSearch: tool({
      description:
        'Find documents by name or title. Pass 1-3 keywords that would literally appear in the title.',
      inputSchema: z.object({
        name: z.string().describe('The name or title to search.'),
        matchType: z.enum(['prefix', 'exact']).optional(),
        entityTypes: z.array(z.string()).optional(),
      }),
      execute: async ({ name, matchType }) => {
        const terms = name.toLowerCase().split(/\s+/).filter(Boolean);
        const docs = await deps.listDocuments();
        const matches = docs.filter((doc) => {
          const words = doc.title.toLowerCase().split(/\s+/);
          return terms.every((term) =>
            matchType === 'exact'
              ? words.includes(term)
              : words.some((word) => word.startsWith(term))
          );
        });
        return {
          results: matches.map((doc) => ({
            type: 'document' as const,
            id: doc.id,
            name: doc.title,
            document_id: doc.id,
            document_name: doc.title,
            file_type: doc.kind,
          })),
        };
      },
    }),

    CreateDocument: tool({
      description: 'Create a new markdown document with the given content.',
      inputSchema: z.object({
        documentName: z
          .string()
          .describe('The name of the document without the file extension'),
        fileContent: z
          .string()
          .describe('The string content of the document you are creating.'),
        fileExtension: z
          .string()
          .describe('The extension of the plaintext file you are creating.'),
      }),
      execute: async ({ documentName, fileContent }) => {
        const created = await deps.documents.create({ title: documentName });
        if (created.isErr()) return { error: created.error };
        // The content is markdown already; parsing it is a local operation,
        // not an editing session — the origin writes the file and so do we.
        if (fileContent.trim()) {
          const saved = await deps.documents.save({
            id: created.value.id,
            tree: markdownToState(fileContent) as unknown as SerializedTree,
            markdown: fileContent,
            preview: fileContent.slice(0, 200),
            author: { user: LOCAL_USER_ID, src: 'ai' },
          });
          if (saved.isErr()) return { error: saved.error };
        }
        return { documentId: created.value.id };
      },
    }),

    RenameDocument: tool({
      description: 'Rename a document.',
      inputSchema: z.object({
        documentId: z
          .string()
          .describe('The id of the document you want to rename.'),
        documentName: z
          .string()
          .describe(
            'The new name for the document without the file extension.'
          ),
      }),
      execute: async ({ documentId, documentName }) => {
        const renamed = await deps.documents.rename(documentId, documentName);
        return renamed.isOk()
          ? { success: true, documentId, message: `Renamed to ${documentName}` }
          : { success: false, documentId, message: renamed.error };
      },
    }),

    EditDocument: tool({
      description:
        'Edit a markdown document with natural-language instructions. If you are not certain the document is markdown, call ReadMetadata first.',
      inputSchema: z.object({
        document_id: z
          .string()
          .describe('The ID of the markdown document to edit.'),
        instructions: z
          .string()
          .describe('Natural language instructions for the edit.'),
      }),
      execute: async ({ document_id, instructions }, { abortSignal }) =>
        deps.editDocument({
          documentId: document_id,
          instructions,
          signal: abortSignal,
        }),
    }),
  };
}
