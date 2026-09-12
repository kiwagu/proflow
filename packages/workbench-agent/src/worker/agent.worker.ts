/// <reference lib="webworker" />
// Must stay the first import: see the module's own comment.
import './prism-guard';
import { serveAgent } from '@workspace/ai-agent';
import type { DocumentMeta, FileNode } from '@workspace/domain';
import { createWorkerEmbedder } from '@workspace/embedding';
import { createHashEmbedder } from '@workspace/embedding/testing';
import {
  createDocumentCrdtStore,
  createPgliteDocumentListReader,
  createPgliteDocumentRepository,
  createPgliteFileTreeReader,
  createPgliteSemanticSearch,
  openLocalDatabase,
} from '@workspace/persistence-pglite';
import { createAgentWorkerDeps } from './composition';

/**
 * The agent worker's composition root.
 *
 * The chat's model loop and the document editing session run here, beside
 * the page rather than on it: a tool call is a database query and an edit
 * session is a model conversation plus a sandbox, neither of which belongs
 * on the thread that paints. The worker opens the same database through
 * its own client and builds its own port adapters over it.
 *
 * `?embedder=hash` on the worker URL swaps the model-backed embedder for the
 * deterministic hash one, so a test exercises the search tools without a
 * network or a model download. `?namespace=` names the database to open:
 * one page, one database — without it the worker would open the default
 * one beside the page's own, and every tool would read an empty store.
 */
const workerUrl = new URL(self.location.href);
const embedderChoice = workerUrl.searchParams.get('embedder');
const namespace = workerUrl.searchParams.get('namespace');

const db = await openLocalDatabase(undefined, namespace ?? undefined);
const documentCrdt = createDocumentCrdtStore(db);
const documents = createPgliteDocumentRepository(db, documentCrdt);
const documentList = createPgliteDocumentListReader(db);
const embedder =
  embedderChoice === 'hash' ? createHashEmbedder() : createWorkerEmbedder();
const search = createPgliteSemanticSearch(db, embedder);

const listDocuments = () =>
  new Promise<DocumentMeta[]>((resolve) => {
    const unsubscribe = documentList.watchRecent((docs) => {
      resolve(docs);
      queueMicrotask(unsubscribe);
    });
  });

const fileTree = createPgliteFileTreeReader(db);
const listFiles = () =>
  new Promise<FileNode[]>((resolve) => {
    const unsubscribe = fileTree.watchAll((nodes) => {
      resolve(nodes);
      queueMicrotask(unsubscribe);
    });
  });

serveAgent(
  createAgentWorkerDeps({ documents, listDocuments, listFiles, search })
);
