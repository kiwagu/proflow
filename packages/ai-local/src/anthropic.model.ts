import { createAnthropic } from '@ai-sdk/anthropic';
import type { SharedV3ProviderOptions as ProviderOptions } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';

/**
 * Chat models this provider accepts, by their `provider/model` selector id.
 * The map is also the thinking policy: adaptive thinking with a summarized
 * display streams visible reasoning on the models that support it, and is
 * omitted on the one that would reject it.
 */
const MODELS: Record<string, { apiId: string; thinking: boolean }> = {
  'anthropic/claude-sonnet-5': { apiId: 'claude-sonnet-5', thinking: true },
  'anthropic/claude-opus-5': { apiId: 'claude-opus-5', thinking: true },
  'anthropic/claude-haiku-4-5': { apiId: 'claude-haiku-4-5', thinking: false },
};

/** The model the editing session's coders run on. */
const CODING_MODEL = 'anthropic/claude-sonnet-5';

export interface AnthropicModels {
  chat: (selectorId: string) => LanguageModel | undefined;
  providerOptions: (selectorId: string) => ProviderOptions | undefined;
  coding: () => LanguageModel;
}

/**
 * Claude, straight from the browser.
 *
 * Bring-your-own-key only: the direct-browser-access header exists precisely
 * for keys the user typed in themselves, and this provider is never
 * constructed without one. The key travels to the provider and nowhere else.
 */
export function createAnthropicModels(options: {
  apiKey: string;
}): AnthropicModels {
  const anthropic = createAnthropic({
    apiKey: options.apiKey,
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  });
  const resolve = (selectorId: string) => MODELS[selectorId];
  return {
    chat: (selectorId) => {
      const model = resolve(selectorId);
      return model ? anthropic(model.apiId) : undefined;
    },
    providerOptions: (selectorId) =>
      resolve(selectorId)?.thinking
        ? {
            anthropic: {
              thinking: { type: 'adaptive', display: 'summarized' },
            },
          }
        : undefined,
    coding: () => anthropic(MODELS[CODING_MODEL]!.apiId),
  };
}

export const ANTHROPIC_MODEL_IDS = Object.keys(MODELS);
