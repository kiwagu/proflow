import type { ILlmGateway } from '@workspace/domain';
import type { SerializedEditorState } from 'lexical';
import type {
  AgentConfig,
  EditOutcome,
  FromWorker,
  ToWorker,
} from './protocol';

/** The worker's view of the page's open document. */
export interface PageDocument {
  readState: (documentId: string) => Promise<SerializedEditorState | null>;
  applyEdit: (
    documentId: string,
    result: EditOutcome,
    partial: boolean
  ) => Promise<boolean>;
}

export interface ServeAgentDeps {
  /** Build (or rebuild) the gateway for a configuration. */
  gatewayFor: (config: AgentConfig, page: PageDocument) => ILlmGateway;
  /** Run an editing session and return its outcome, unapplied. */
  editFor: (
    config: AgentConfig,
    page: PageDocument
  ) => (input: {
    documentId: string;
    prompt: string;
    signal: AbortSignal;
  }) => Promise<EditOutcome>;
}

/**
 * The worker's end of the protocol: runs chat turns and edit sessions
 * through the configured gateway and relays every chunk to the page. Call
 * once from the worker module after everything it imports has loaded; it
 * posts `ready` last.
 */
export function serveAgent(deps: ServeAgentDeps) {
  const scope = self as unknown as {
    postMessage: (message: FromWorker) => void;
    addEventListener: (
      type: 'message',
      handler: (event: MessageEvent<ToWorker>) => void
    ) => void;
  };
  const post = (message: FromWorker) => scope.postMessage(message);

  let gateway: ILlmGateway | undefined;
  let edit: ReturnType<ServeAgentDeps['editFor']> | undefined;
  const turns = new Map<string, AbortController>();
  const pendingReads = new Map<
    string,
    (state: SerializedEditorState | null) => void
  >();
  const pendingApplies = new Map<string, (applied: boolean) => void>();
  let askIds = 0;

  const page: PageDocument = {
    readState: (documentId) =>
      new Promise((resolve) => {
        const id = `read-${++askIds}`;
        pendingReads.set(id, resolve);
        post({ type: 'read-state', id, documentId });
      }),
    applyEdit: (documentId, result, partial) =>
      new Promise((resolve) => {
        const id = `apply-${++askIds}`;
        pendingApplies.set(id, resolve);
        post({ type: 'apply-edit', id, documentId, result, partial });
      }),
  };

  scope.addEventListener('message', async (event) => {
    const message = event.data;
    switch (message.type) {
      case 'configure':
        gateway = deps.gatewayFor(message.config, page);
        edit = deps.editFor(message.config, page);
        break;
      case 'read-state-result':
        pendingReads.get(message.id)?.(message.state);
        pendingReads.delete(message.id);
        break;
      case 'apply-edit-result':
        pendingApplies.get(message.id)?.(message.applied);
        pendingApplies.delete(message.id);
        break;
      case 'abort':
        turns.get(message.id)?.abort();
        break;
      case 'edit': {
        const controller = new AbortController();
        turns.set(message.id, controller);
        try {
          if (!edit) throw new Error('agent not configured');
          const result = await edit({
            documentId: message.documentId,
            prompt: message.prompt,
            signal: controller.signal,
          });
          post({ type: 'edit-result', id: message.id, result });
        } catch (error) {
          post({
            type: 'edit-result',
            id: message.id,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          turns.delete(message.id);
        }
        break;
      }
      case 'chat': {
        const controller = new AbortController();
        turns.set(message.id, controller);
        try {
          if (!gateway) {
            console.error('agent turn before configuration arrived');
            post({
              type: 'chunk',
              id: message.id,
              chunk: { type: 'error', reason: 'provider_error' },
            });
            return;
          }
          for await (const chunk of gateway.streamChat({
            ...message.request,
            signal: controller.signal,
          })) {
            post({ type: 'chunk', id: message.id, chunk });
          }
        } catch (error) {
          console.error('agent turn failed', error);
          post({
            type: 'chunk',
            id: message.id,
            chunk: { type: 'error', reason: 'unknown' },
          });
        } finally {
          turns.delete(message.id);
          post({ type: 'end', id: message.id });
        }
        break;
      }
      default:
        break;
    }
  });

  post({ type: 'ready' });
}
