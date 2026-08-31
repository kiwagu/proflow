export interface LlmProviderConfig {
  provider: 'mock' | 'anthropic';
  apiKey: string | null;
}

/** Which provider a call with this config would actually use. */
export function activeProvider(
  config: LlmProviderConfig
): 'mock' | 'anthropic' {
  return config.provider === 'anthropic' && config.apiKey
    ? 'anthropic'
    : 'mock';
}
