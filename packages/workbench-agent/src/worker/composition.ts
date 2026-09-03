import {
  type AgentConfig,
  createAgentGateway,
  createDocumentTools,
  createEditDocument,
  type ResolvedModels,
  runEditSession,
  type ServeAgentDeps,
} from '@workspace/ai-agent';
import {
  createAnthropicModels,
  createMockLanguageModel,
} from '@workspace/ai-local';
import type {
  DocumentMeta,
  FileNode,
  IDocumentRepository,
  ISemanticSearch,
  SerializedTree,
} from '@workspace/domain';
import type { LanguageModel } from 'ai';
import type { SerializedEditorState } from 'lexical';

/**
 * What the worker's composition root needs from its host: the ports it
 * serves the agent over. Kept as an interface so the same wiring runs over
 * the real local database in the worker and over in-memory doubles in a
 * test harness — the protocol loop is the subject, not the storage.
 */
export interface AgentWorkerPorts {
  documents: IDocumentRepository;
  listDocuments: () => Promise<DocumentMeta[]>;
  listFiles: () => Promise<FileNode[]>;
  search: ISemanticSearch;
}

type Models = {
  chat: (id: string) => LanguageModel | undefined;
  providerOptions: (id: string) => Record<string, never> | undefined;
  editing: () => ResolvedModels;
};

const mock = () => createMockLanguageModel();

/**
 * Provider selection, as the page pushes it across: a real provider when a
 * key is configured, the scripted local model otherwise. The chat's model
 * selector ids are `provider/model`; anything the configured provider does
 * not own falls back to the mock so a stale selection never fails a send.
 */
function modelsFor(config: AgentConfig): Models {
  if (config.provider === 'anthropic' && config.apiKey) {
    const anthropic = createAnthropicModels({ apiKey: config.apiKey });
    return {
      chat: (id) => (id.startsWith('anthropic/') ? anthropic.chat(id) : mock()),
      providerOptions: (id) =>
        anthropic.providerOptions(id) as Record<string, never> | undefined,
      editing: () => ({
        supervisor: anthropic.coding(),
        interpret: anthropic.coding(),
        coding: () => anthropic.coding(),
      }),
    };
  }
  return {
    chat: () => mock(),
    providerOptions: () => undefined,
    editing: () => ({
      supervisor: mock(),
      interpret: mock(),
      coding: () => mock(),
    }),
  };
}

/**
 * The agent's dependencies over a set of ports: the chat gateway with the
 * document tools, and the selection-edit runner. Both take the page's open
 * document into account — an edit starts from what the editor holds and
 * lands back in it when the document is open, and goes through the store
 * when it is not.
 */
export function createAgentWorkerDeps(ports: AgentWorkerPorts): ServeAgentDeps {
  return {
    editFor: (config, page) => {
      const models = modelsFor(config);
      return async ({ documentId, prompt, signal }) => {
        const live = await page.readState(documentId);
        let state = live ?? undefined;
        if (!state) {
          const loaded = await ports.documents.load(documentId);
          if (loaded.isErr()) throw new Error(loaded.error);
          state = loaded.value.content?.tree as SerializedTree | undefined as
            SerializedEditorState | undefined;
        }
        if (!state) throw new Error('document has no content');
        const result = await runEditSession({
          state,
          prompt,
          models: models.editing(),
          signal,
          onProgress: live
            ? (partial) => void page.applyEdit(documentId, partial, true)
            : undefined,
        });
        return { ops: result.ops, state: result.state };
      };
    },
    gatewayFor: (config, page) => {
      const models = modelsFor(config);
      const editDocument = createEditDocument({
        documents: ports.documents,
        models: models.editing,
        openEditor: page,
      });
      return createAgentGateway({
        model: models.chat,
        providerOptions: models.providerOptions,
        tools: createDocumentTools({
          documents: ports.documents,
          listDocuments: ports.listDocuments,
          listFiles: ports.listFiles,
          search: ports.search,
          editDocument,
        }),
      });
    },
  };
}
