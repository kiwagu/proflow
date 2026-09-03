# `@workspace/ai-local`

Model providers for the agent: a scripted local model, and Claude through a
user-supplied key.

## Role in the architecture

Driven-adapter package, and the only workspace member that declares the
provider SDK (`@ai-sdk/anthropic`). It produces AI SDK language models; the
loop that runs them lives in `@workspace/ai-agent`, and the app's composition
roots decide which provider is active.

- `createMockLanguageModel()` — the default, and deliberately so: the chat
  must work offline and be testable deterministically. Its tool calls are
  real — it searches through the agent's `ContentSearch` tool and, for a
  message starting with `edit:`, edits the open document through
  `EditDocument`, playing both editing-session agents when it gets there.
- `createAnthropicModels({ apiKey })` — bring-your-own-key only; the key
  travels to the provider and nowhere else.
