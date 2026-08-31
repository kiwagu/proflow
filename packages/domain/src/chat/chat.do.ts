export interface ChatMeta {
  id: string;
  name: string;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ChatRole = 'user' | 'assistant' | 'system';

/**
 * 'interrupted' is a reply the user stopped, or one a closed tab never let
 * finish: what arrived is kept and shown as such, unlike 'error'.
 */
export type MessageStatus = 'complete' | 'streaming' | 'error' | 'interrupted';

/**
 * One persisted part of an assistant turn. Parts are stored as rows (not one
 * JSON column) because streaming appends them one at a time and an
 * interrupted turn must stay representable.
 */
export interface StoredMessagePart {
  idx: number;
  type: string;
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  seq: number;
  text: string;
  model: string | null;
  status: MessageStatus;
  createdAt: Date;
  parts: StoredMessagePart[];
}
