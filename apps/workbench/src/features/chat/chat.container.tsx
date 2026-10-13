/**
 * The panel's session, opened against the app's ports.
 *
 * Kept apart from `ChatPanel` so the view stays a pure function of session
 * state: this is the only place that knows about the composition root and
 * the agent worker, and it is what a spec does NOT have to stand up.
 *
 * `chatId` is `null` — one scratch chat per mount. Listing and switching
 * chats is a later slice; opening a new one here is the behaviour that needs
 * nothing else to exist yet.
 */
import { useAgent, useChatSession } from '@workspace/workbench-agent';
import { newId } from '@workspace/domain';
import { useMemo } from 'react';
import { useServices } from '../../composition/app-services';
import type { ChatPanelLabels } from './chat.labels';
import { ChatPanel } from './chat.panel';

export function ChatPanelContainer({ labels }: { labels?: ChatPanelLabels }) {
  const services = useServices();
  const { client } = useAgent();

  const deps = useMemo(
    () => ({
      chats: services.chats,
      chatList: services.chatList,
      messages: services.chatMessages,
      llm: client,
      // The app's one id generator, so a chat row is addressed the same way
      // every other row is.
      newId: (kind: 'chatMessage' | 'stream') =>
        newId(kind === 'stream' ? 'chatStream' : 'chatMessage'),
    }),
    [services, client]
  );

  const session = useChatSession(deps, null);
  return <ChatPanel session={session} labels={labels} />;
}
