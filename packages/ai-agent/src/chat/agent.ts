import type { SharedV3ProviderOptions as ProviderOptions } from '@ai-sdk/provider';
import type { ILlmGateway, LlmChatRequest, LlmChunk } from '@workspace/domain';
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolSet,
} from 'ai';

/** How many model turns one chat message may take, tool calls included. */
const MAX_STEPS = 12;

export interface AgentGatewayDeps {
  /** Resolve the selector id the chat uses (`provider/model`) to a model. */
  model: (modelId: string) => LanguageModel | undefined;
  /** Per-model provider options — thinking policy, for one. */
  providerOptions?: (modelId: string) => ProviderOptions | undefined;
  tools: ToolSet;
}

/**
 * The transcript as the model takes it. A turn that failed or was cut off
 * leaves an assistant message with no text; the provider rejects a request
 * carrying one ("text content blocks must be non-empty"), and every later
 * send would carry it again — so empty messages are dropped here, and
 * same-role neighbours that leaves behind are merged.
 */
function toModelMessages(request: LlmChatRequest): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const m of request.messages) {
    const text = m.text.trim();
    if (!text) continue;
    const last = messages.at(-1);
    if (last && last.role === m.role && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${text}`;
      continue;
    }
    messages.push({ role: m.role, content: text } as ModelMessage);
  }
  return messages;
}

/**
 * The chat loop: a model with the document tools, run until it stops
 * calling them.
 *
 * This is the port implementation the chat sends through. It speaks the
 * domain's chunk vocabulary outward and the AI SDK inward; the tool loop —
 * call, execute, feed the result back, call again — is the SDK's, driven
 * by the `execute` functions on the tools.
 */
export function createAgentGateway(deps: AgentGatewayDeps): ILlmGateway {
  return {
    async *streamChat(request: LlmChatRequest): AsyncIterable<LlmChunk> {
      const model = deps.model(request.model);
      if (!model) {
        yield { type: 'error', reason: 'provider_error' };
        return;
      }

      try {
        const result = streamText({
          model,
          system: request.systemPrompt,
          messages: toModelMessages(request),
          tools: deps.tools,
          stopWhen: stepCountIs(MAX_STEPS),
          abortSignal: request.signal,
          providerOptions: deps.providerOptions?.(request.model),
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              yield { type: 'text', text: part.text };
              break;
            case 'reasoning-delta':
              yield { type: 'thinking', thinking: part.text };
              break;
            case 'tool-call':
              yield {
                type: 'tool_call',
                id: part.toolCallId,
                name: part.toolName,
                input: part.input,
              };
              break;
            case 'tool-result':
              yield {
                type: 'tool_result',
                id: part.toolCallId,
                name: part.toolName,
                output: part.output,
              };
              break;
            case 'tool-error':
              yield {
                type: 'tool_error',
                id: part.toolCallId,
                name: part.toolName,
                message: describe(part.error),
              };
              break;
            case 'error':
              // The chunk carries only a reason; the cause goes to the
              // console so an outage and a bad request stay tellable apart.
              console.error('model error', part.error);
              yield { type: 'error', reason: classify(part.error) };
              return;
            default:
              break;
          }
        }
        yield { type: 'done' };
      } catch (error) {
        if (request.signal?.aborted) return;
        console.error('model error', error);
        yield { type: 'error', reason: classify(error) };
      }
    },
  };
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** A context overflow is actionable by the user; everything else is not. */
function classify(error: unknown): 'provider_error' | 'model_context_overflow' {
  return /prompt is too long|context/i.test(describe(error))
    ? 'model_context_overflow'
    : 'provider_error';
}
