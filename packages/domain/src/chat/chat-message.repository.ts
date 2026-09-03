import type { Result } from 'neverthrow';
import type { ChatMessage, StoredMessagePart } from './chat.do.js';

/**
 * Port: the chat transcript, at streaming granularity.
 *
 * An assistant turn is opened with `beginAssistantMessage`, grows part by
 * part with `appendPart`, and is closed with `finishAssistantMessage` — so a
 * tab killed mid-stream leaves a truthful 'streaming'/'error' row instead of
 * a hole.
 *
 * Each turn also has a stream record: the stream's id (what the UI and the
 * worker address the turn by), when it ran, how it ended and why. The
 * message holds what was said; the stream holds what happened.
 */
export interface IChatMessageRepository {
  appendUserMessage(input: {
    id: string;
    chatId: string;
    text: string;
  }): Promise<Result<ChatMessage, string>>;
  beginAssistantMessage(input: {
    id: string;
    chatId: string;
    model: string;
  }): Promise<Result<void, string>>;
  appendPart(input: {
    messageId: string;
    chatId: string;
    part: StoredMessagePart;
  }): Promise<Result<void, string>>;
  finishAssistantMessage(
    messageId: string,
    status: 'complete' | 'error' | 'interrupted',
    text?: string
  ): Promise<Result<void, string>>;
  beginStream(input: {
    id: string;
    chatId: string;
    messageId: string;
  }): Promise<Result<void, string>>;
  endStream(
    id: string,
    status: 'complete' | 'error' | 'interrupted',
    error?: string
  ): Promise<Result<void, string>>;
  /** Streams still marked as running: what a closed tab left behind. */
  listOpenStreams(
    chatId: string
  ): Promise<Result<{ id: string; messageId: string }[], string>>;
  listByChat(chatId: string): Promise<Result<ChatMessage[], string>>;
}
