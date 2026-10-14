/// <reference lib="webworker" />
// Must stay the first import: see the module's own comment.
import './prism-guard';
import { serveAgent } from '@workspace/ai-agent';
import { createAgentWorkerDeps } from './composition';
import {
  createPortChannel,
  createProxyDocumentRepository,
  createProxyLists,
  createProxySemanticSearch,
} from './proxy-ports';

/**
 * The agent worker's composition root.
 *
 * The chat's model loop and the document editing session run here, beside
 * the page rather than on it: a tool call is a database query and an edit
 * session is a model conversation plus a sandbox, neither of which belongs
 * on the thread that paints.
 *
 * It does NOT open the database. The local database is exclusive — one PGlite
 * worker holds its files, and tabs cope only because they elect a leader
 * among themselves. This is a nested worker: a client opened here starts a
 * second PGlite worker that contends for the same files, and the page's own
 * boot then fails with "another tab is holding the database". So every port
 * is a proxy back to the page, which owns the one client, exactly as the open
 * editor's state already crosses this protocol.
 *
 * Nothing needs configuring before this module runs, either: the namespace
 * question belongs to whoever opens the database, and that is no longer this
 * worker. The embedder likewise stays on the page's side of the proxy —
 * search is a port call now, not a local index.
 */
const scope = self as unknown as Parameters<typeof createPortChannel>[0];
const channel = createPortChannel(scope);

const documents = createProxyDocumentRepository(channel);
const search = createProxySemanticSearch(channel);
const { listDocuments, listFiles } = createProxyLists(channel);

serveAgent(
  createAgentWorkerDeps({ documents, listDocuments, listFiles, search })
);
