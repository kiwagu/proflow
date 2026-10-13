/**
 * A chat session stub, shared by the panel's specs.
 *
 * The panel is a pure view over `UseChatSession`, so every spec drives it
 * the same way: hand in a session whose state is written by hand. Kept in
 * one place so the surface's specs cannot drift apart in what they call a
 * session.
 */
import type { UseChatSession } from '@workspace/workbench-agent';

export function stubSession(
  over: Partial<UseChatSession> = {}
): UseChatSession {
  return {
    chatId: 'cht-1',
    messages: [],
    streaming: null,
    generating: false,
    error: null,
    ready: true,
    openError: null,
    send: () => Promise.resolve(),
    stop: () => {},
    ...over,
  };
}
