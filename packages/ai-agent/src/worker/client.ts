import type { ILlmGateway, LlmChatRequest, LlmChunk } from '@workspace/domain';
import type { SerializedEditorState } from 'lexical';
import type {
  AgentConfig,
  EditOutcome,
  FromWorker,
  ToWorker,
} from './protocol';

/**
 * The page's side of an open document: read what the editor currently
 * holds, and take an edit's result into it. Both answer `false`/`null` when
 * the document is not the one open.
 */
export interface OpenDocumentHooks {
  readState: (documentId: string) => SerializedEditorState | null;
  applyEdit: (
    documentId: string,
    result: EditOutcome,
    partial: boolean
  ) => boolean;
}

export interface AgentWorkerClient extends ILlmGateway {
  /**
   * Run an editing session on a document and return its outcome without
   * applying it — the caller lands it where it wants it.
   */
  editDocument(input: {
    documentId: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<EditOutcome>;
  /** Push the provider choice and key into the worker. */
  configure(config: AgentConfig): void;
  /**
   * Register the open document's hooks. One at a time: the page has one
   * editor, and the registration is replaced, not stacked.
   */
  setOpenDocumentHooks(hooks: OpenDocumentHooks | undefined): void;
  /** Resolves once the worker has evaluated and can take messages. */
  ready: Promise<void>;
}

/**
 * The page's end of the agent worker: an `ILlmGateway` whose streaming
 * happens in another thread.
 *
 * Messages posted before the worker finishes evaluating its module are lost
 * — it awaits WebAssembly on load — so every send waits for `ready`.
 */
export function createAgentWorkerClient(worker: Worker): AgentWorkerClient {
  const streams = new Map<
    string,
    { push: (chunk: LlmChunk) => void; end: () => void }
  >();
  const edits = new Map<
    string,
    { resolve: (result: EditOutcome) => void; reject: (error: Error) => void }
  >();
  let hooks: OpenDocumentHooks | undefined;
  let config: AgentConfig | undefined;
  let ids = 0;

  const send = (message: ToWorker) => worker.postMessage(message);

  const ready = new Promise<void>((resolve) => {
    const onReady = (event: MessageEvent<FromWorker>) => {
      if (event.data?.type === 'ready') {
        worker.removeEventListener('message', onReady);
        resolve();
      }
    };
    worker.addEventListener('message', onReady);
  });

  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    switch (message.type) {
      case 'ready':
        // The worker announces itself on every start — including a restart
        // under the dev server — and its configuration lives only in memory,
        // so it is sent again each time.
        if (config) send({ type: 'configure', config });
        break;
      case 'chunk':
        streams.get(message.id)?.push(message.chunk);
        break;
      case 'end':
        streams.get(message.id)?.end();
        streams.delete(message.id);
        break;
      case 'edit-result': {
        const pending = edits.get(message.id);
        edits.delete(message.id);
        if (!pending) break;
        if (message.result) pending.resolve(message.result);
        else pending.reject(new Error(message.error ?? 'edit failed'));
        break;
      }
      case 'read-state': {
        let state: SerializedEditorState | null = null;
        try {
          state = hooks?.readState(message.documentId) ?? null;
        } catch (error) {
          console.error('reading the open editor failed', error);
        }
        send({ type: 'read-state-result', id: message.id, state });
        break;
      }
      case 'apply-edit': {
        let applied = false;
        try {
          applied =
            hooks?.applyEdit(
              message.documentId,
              message.result,
              message.partial
            ) ?? false;
        } catch (error) {
          console.error(
            'applying the AI edit to the open editor failed',
            error
          );
        }
        send({ type: 'apply-edit-result', id: message.id, applied });
        break;
      }
      default:
        break;
    }
  });

  return {
    ready,
    configure(next) {
      config = next;
      void ready.then(() => send({ type: 'configure', config: next }));
    },
    setOpenDocumentHooks(next) {
      hooks = next;
    },
    async editDocument({ documentId, prompt, signal }) {
      await ready;
      const id = `edit-${++ids}`;
      const onAbort = () => send({ type: 'abort', id });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        return await new Promise<EditOutcome>((resolve, reject) => {
          edits.set(id, { resolve, reject });
          send({ type: 'edit', id, documentId, prompt });
        });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
    streamChat(request: LlmChatRequest): AsyncIterable<LlmChunk> {
      const id = `turn-${++ids}`;
      const queue: LlmChunk[] = [];
      let done = false;
      let wake: (() => void) | undefined;
      const notify = () => {
        wake?.();
        wake = undefined;
      };
      streams.set(id, {
        push: (chunk) => {
          queue.push(chunk);
          notify();
        },
        end: () => {
          done = true;
          notify();
        },
      });

      const { signal, ...rest } = request;
      const onAbort = () => send({ type: 'abort', id });
      signal?.addEventListener('abort', onAbort, { once: true });

      return {
        async *[Symbol.asyncIterator]() {
          await ready;
          send({ type: 'chat', id, request: rest });
          try {
            while (true) {
              if (queue.length > 0) {
                yield queue.shift()!;
                continue;
              }
              if (done) return;
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          } finally {
            signal?.removeEventListener('abort', onAbort);
            streams.delete(id);
          }
        },
      };
    },
  };
}
