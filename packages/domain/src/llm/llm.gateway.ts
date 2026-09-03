import type { LlmChatRequest, LlmChunk } from './llm-chunk.vo.js';

/** Port: streaming chat completion from some model provider. */
export interface ILlmGateway {
  streamChat(request: LlmChatRequest): AsyncIterable<LlmChunk>;
}
