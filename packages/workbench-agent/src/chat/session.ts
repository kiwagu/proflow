/**
 * @file A chat session: the transcript, the turn in flight, and its end.
 *
 * A session is the pairing of one stored chat with the one turn that may be
 * running against it. It is framework-free on purpose — the React layer
 * above subscribes to it, and a test drives it directly without rendering
 * anything.
 *
 * Three things it owns that a surface would otherwise re-derive:
 *  - resuming: a tab closed mid-stream leaves rows claiming to be streaming,
 *    which is a lie the moment the page reloads. Settling them is the first
 *    thing a session does with a chat it did not start.
 *  - the live turn: parts arrive faster than storage can take them, so the
 *    turn in flight is held in memory and the transcript is re-read once it
 *    settles, rather than on every chunk.
 *  - stopping: one turn at a time, abortable from the moment it is asked
 *    for — including before the first storage write returns.
 */
import type {
  IChatListReader,
  IChatMessageRepository,
  IChatRepository,
  ILlmGateway,
  LlmMessage,
} from '@workspace/domain';
import type { AssistantPart, RenderableMessage } from './parts';
import { toRenderableMessage } from './parts';
import { runChatTurn } from './turn';

/** The model a chat uses until one is chosen for it. */
export const DEFAULT_CHAT_MODEL = 'mock/default';

export interface ChatSessionDeps {
  chats: IChatRepository;
  chatList: IChatListReader;
  messages: IChatMessageRepository;
  llm: ILlmGateway;
  /** Fresh ids for messages and streams; injected so a test can make them stable. */
  newId: (kind: 'chatMessage' | 'stream') => string;
}

export interface ChatSessionState {
  chatId: string;
  /** The settled transcript, newest last. */
  messages: RenderableMessage[];
  /**
   * The turn in flight: its parts as they arrive. Empty when nothing is
   * generating. Kept beside `messages` rather than inside it so a surface
   * can render the live turn without the transcript being rewritten per
   * chunk.
   */
  streaming: { messageId: string; parts: AssistantPart[] } | null;
  /** True from the moment a send is asked for until its turn settles. */
  generating: boolean;
  /** The last send that failed, for a surface to show. Cleared by the next send. */
  error: string | null;
}

export interface ChatSession {
  getState: () => ChatSessionState;
  subscribe: (listener: () => void) => () => void;
  /** Send a user message and run the model's reply. Resolves when it settles. */
  send: (text: string, options?: { model?: string }) => Promise<void>;
  /** Stop the turn in flight. What arrived is kept and marked interrupted. */
  stop: () => void;
  /** Release the session; a turn in flight is stopped. */
  dispose: () => void;
}

/**
 * A generation that never finished. A tab closed mid-stream leaves its
 * assistant message in 'streaming'; on the next open that is a lie —
 * nothing is streaming — so it is settled to 'interrupted' before anything
 * renders. The parts that did arrive are kept: a truncated answer is worth
 * more than a spinner that never stops.
 */
export async function settleInterrupted(
  messages: IChatMessageRepository,
  chatId: string
): Promise<void> {
  const open = await messages.listOpenStreams(chatId);
  if (open.isOk()) {
    for (const stream of open.value) {
      await messages.endStream(stream.id, 'interrupted', 'tab closed');
    }
  }
  const stored = await messages.listByChat(chatId);
  if (stored.isErr()) return;
  for (const message of stored.value) {
    if (message.status === 'streaming') {
      await messages.finishAssistantMessage(
        message.id,
        'interrupted',
        message.text
      );
    }
  }
}

/** The most recent chat, or a fresh one the first time the app runs. */
export async function openScratchChat(
  chats: IChatRepository,
  list: IChatListReader
): Promise<string> {
  const existing = await new Promise<{ id: string }[]>((resolve) => {
    const unsubscribe = list.watchRecent((rows) => {
      resolve(rows);
      // The callback can fire synchronously from inside `watchRecent`, before
      // `unsubscribe` is bound; deferring makes both orders work.
      queueMicrotask(unsubscribe);
    });
  });
  const first = existing[0];
  if (first) return first.id;

  const created = await chats.create('New chat');
  if (created.isErr()) throw new Error(created.error);
  return created.value.id;
}

/**
 * Opens a session on an existing chat: settles what a closed tab left
 * behind, then reads the transcript back.
 */
export async function resumeChatSession(
  deps: ChatSessionDeps,
  chatId: string
): Promise<ChatSession> {
  await settleInterrupted(deps.messages, chatId);
  return createChatSession(deps, chatId);
}

/** Opens a session on a new chat. */
export async function createNewChatSession(
  deps: ChatSessionDeps,
  name?: string
): Promise<ChatSession> {
  const created = await deps.chats.create(name ?? 'New chat');
  if (created.isErr()) throw new Error(created.error);
  return createChatSession(deps, created.value.id);
}

/**
 * A session over a chat that is already in a consistent state. Prefer
 * `resumeChatSession` / `createNewChatSession`, which get it there first.
 */
export function createChatSession(
  deps: ChatSessionDeps,
  chatId: string
): ChatSession {
  let state: ChatSessionState = {
    chatId,
    messages: [],
    streaming: null,
    generating: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let inflight: AbortController | undefined;
  let disposed = false;

  const set = (next: Partial<ChatSessionState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const reload = async () => {
    const stored = await deps.messages.listByChat(chatId);
    if (disposed) return;
    if (stored.isErr()) {
      set({ error: stored.error });
      return;
    }
    set({ messages: stored.value.map(toRenderableMessage) });
  };

  void reload();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      inflight?.abort();
    },
    dispose() {
      disposed = true;
      inflight?.abort();
      listeners.clear();
    },
    async send(text, options) {
      if (disposed) throw new Error('session disposed');
      if (state.generating) throw new Error('a reply is already generating');

      const messageId = deps.newId('chatMessage');
      // Registered before the first await: a stop can arrive while the user
      // message is still being written, and must still be honoured.
      const controller = new AbortController();
      inflight = controller;
      set({ generating: true, error: null });

      const appended = await deps.messages.appendUserMessage({
        id: deps.newId('chatMessage'),
        chatId,
        text,
      });
      if (appended.isErr()) {
        inflight = undefined;
        set({ generating: false, error: appended.error });
        return;
      }
      await reload();
      if (disposed) return;

      const model = options?.model ?? DEFAULT_CHAT_MODEL;
      const history: LlmMessage[] = state.messages
        .filter((message) => message.text.length > 0)
        .map((message) => ({ role: message.role, text: message.text }));

      set({ streaming: { messageId, parts: [] } });
      try {
        await runChatTurn(
          {
            llm: deps.llm,
            messages: deps.messages,
            onPart: (part) => {
              if (disposed || state.streaming?.messageId !== messageId) return;
              set({
                streaming: {
                  messageId,
                  parts: [...state.streaming.parts, part],
                },
              });
            },
          },
          {
            chatId,
            messageId,
            streamId: deps.newId('stream'),
            model,
          },
          { model, messages: history },
          controller.signal
        );
      } finally {
        if (inflight === controller) inflight = undefined;
        if (!disposed) {
          // The transcript is the truth once the turn settles; the live
          // parts are dropped in the same update that brings it in, so the
          // reply never appears twice.
          await reload();
          set({ streaming: null, generating: false });
        }
      }
    },
  };
}
