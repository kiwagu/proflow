/**
 * @file A chat session, as a React hook.
 *
 * The session itself is framework-free; this is the subscription to it.
 * `useSyncExternalStore` rather than local state because the session is the
 * store — a turn's parts arrive from a worker thread on their own schedule,
 * and re-deriving them into component state would mean two sources of the
 * same truth.
 *
 * Which session is open is held the same way, in a small store beside the
 * hook, for the same reason: opening is asynchronous and its result belongs
 * to the effect that started it, not to a render.
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  ChatSession,
  ChatSessionDeps,
  ChatSessionState,
} from '../chat/session';
import { createNewChatSession, resumeChatSession } from '../chat/session';

const EMPTY: ChatSessionState = {
  chatId: '',
  messages: [],
  streaming: null,
  generating: false,
  error: null,
};

export interface UseChatSession extends ChatSessionState {
  /** False until the session has opened; the state above is empty meanwhile. */
  ready: boolean;
  /** Why opening the session failed, if it did. */
  openError: string | null;
  send: (text: string, options?: { model?: string }) => Promise<void>;
  stop: () => void;
}

/** What is open right now, or why nothing is. */
interface OpenState {
  session: ChatSession | null;
  openError: string | null;
}

const NOTHING_OPEN: OpenState = { session: null, openError: null };

/**
 * A one-slot store for the open session.
 *
 * The snapshot identity only changes when the slot does, which is what
 * `useSyncExternalStore` requires — returning a fresh object per read would
 * re-render forever.
 */
function createOpenStore() {
  let state = NOTHING_OPEN;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: OpenState) {
      if (next.session === state.session && next.openError === state.openError)
        return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Opens a chat session and keeps it for as long as the caller is mounted.
 *
 * `chatId` selects the chat to resume; `null` opens a new one. Changing it
 * disposes the previous session — including any turn in flight, which is
 * settled as interrupted rather than left running against a chat nobody is
 * watching.
 */
export function useChatSession(
  deps: ChatSessionDeps,
  chatId: string | null
): UseChatSession {
  const [open] = useState(createOpenStore);
  const { session, openError } = useSyncExternalStore(
    open.subscribe,
    open.getSnapshot,
    open.getSnapshot
  );

  // Read per open rather than captured, so a caller may pass a fresh deps
  // object each render without reopening the session; the ports themselves
  // are stable for the page.
  const openSession = useEffectEvent((id: string | null) =>
    id ? resumeChatSession(deps, id) : createNewChatSession(deps)
  );

  useEffect(() => {
    let opened: ChatSession | undefined;
    let cancelled = false;
    open.set(NOTHING_OPEN);

    void openSession(chatId).then(
      (next) => {
        opened = next;
        // Unmounted while opening: the session is live and owns a worker
        // subscription, so it is disposed rather than dropped.
        if (cancelled) next.dispose();
        else open.set({ session: next, openError: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        open.set({
          session: null,
          openError: error instanceof Error ? error.message : String(error),
        });
      }
    );

    return () => {
      cancelled = true;
      opened?.dispose();
    };
  }, [chatId, open]);

  const subscribe = useCallback(
    (listener: () => void) => session?.subscribe(listener) ?? (() => {}),
    [session]
  );
  const getSnapshot = useCallback(
    () => session?.getState() ?? EMPTY,
    [session]
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const send = useCallback(
    async (text: string, options?: { model?: string }) => {
      if (!session) throw new Error('chat session is not open yet');
      await session.send(text, options);
    },
    [session]
  );
  const stop = useCallback(() => session?.stop(), [session]);

  return { ...state, ready: session !== null, openError, send, stop };
}
