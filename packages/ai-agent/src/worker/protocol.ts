import type { LlmChatRequest, LlmChunk } from '@workspace/domain';
import type { SerializedEditorState } from 'lexical';
import type { EditOutcome } from '../editing/run-edit';

/**
 * The messages between the page and the agent worker.
 *
 * The page drives chat turns and selection edits, and answers two questions
 * from the worker — "what is the current state of this document, if an
 * editor has it open?" before a session, and "take this result" after it —
 * so an AI edit starts from what the user sees and lands in their undo
 * stack when it can, and in the store when it cannot.
 */
export type AgentConfig = {
  provider: 'mock' | 'anthropic';
  apiKey: string | null;
};

export type ToWorker =
  | { type: 'configure'; config: AgentConfig }
  | {
      type: 'chat';
      id: string;
      request: Omit<LlmChatRequest, 'signal'>;
    }
  | {
      type: 'edit';
      id: string;
      documentId: string;
      prompt: string;
    }
  | { type: 'abort'; id: string }
  | {
      type: 'read-state-result';
      id: string;
      state: SerializedEditorState | null;
    }
  | { type: 'apply-edit-result'; id: string; applied: boolean };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'chunk'; id: string; chunk: LlmChunk }
  | { type: 'end'; id: string }
  | {
      type: 'edit-result';
      id: string;
      result: EditOutcome | null;
      error?: string;
    }
  | { type: 'read-state'; id: string; documentId: string }
  | {
      type: 'apply-edit';
      id: string;
      documentId: string;
      result: EditOutcome;
      /** True while the session is still running: more will follow. */
      partial: boolean;
    };

export type { EditOutcome } from '../editing/run-edit';
