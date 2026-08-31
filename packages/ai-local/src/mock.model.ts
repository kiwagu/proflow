import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

/**
 * The canned reply. It deliberately exercises the whole render path —
 * headings, nested lists, a table, fenced code, inline math, a thinking
 * block and one tool round-trip — so that "the mock works" and "the chat
 * renders" are the same statement.
 */
const THINKING =
  'The user is greeting the assistant. A short structured reply will ' +
  'exercise every part of the renderer.';

const REPLY = `## Hello from the local model

You said: *"%QUERY%"*

Here is a little of everything:

1. First, an ordered list
2. With a nested one:
   - bullet
   - another bullet

| feature | status |
| --- | --- |
| markdown | works |
| tables | works |

Some \`inline code\` and a block:

\`\`\`ts
const answer = 42;
\`\`\`

And inline math: $e^{i\\pi} + 1 = 0$.
`;

/** `edit: <instructions>` asks the mock to edit the open document. */
const EDIT_COMMAND = /^edit:\s*(.+)$/is;

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: 0,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

/** Split into word-ish chunks so streaming is visible, not instantaneous. */
function* pieces(text: string): Generator<string> {
  for (const part of text.split(/(?<=\s)/)) yield part;
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MockModelOptions {
  /** Delay between chunks. Zero makes tests fast; a few ms looks alive. */
  delayMs?: number;
}

/** What the conversation so far tells the script. */
function readPrompt(prompt: LanguageModelV3Message[]) {
  let query = '';
  let system = '';
  let lastToolResult: { toolName: string; output: unknown } | undefined;
  for (const message of prompt) {
    if (message.role === 'system') system += `${message.content}\n`;
    if (message.role === 'user') {
      query = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('');
    }
    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type === 'tool-result') {
          const output = part.output;
          lastToolResult = {
            toolName: part.toolName,
            output:
              output.type === 'json' || output.type === 'error-json'
                ? output.value
                : output.type === 'text' || output.type === 'error-text'
                  ? output.value
                  : null,
          };
        }
      }
    }
  }
  // The open-document line the application adds to the system prompt:
  // "- <name> (document, id: <id>)".
  const openDocumentId = system.match(/\((?:md|document), id: ([^)]+)\)/)?.[1];
  return {
    query: query.slice(0, 120) || 'nothing',
    fullQuery: query,
    lastToolResult,
    openDocumentId,
  };
}

/**
 * A model that is entirely local and entirely predictable.
 *
 * It is the default provider on purpose: the chat must be buildable,
 * testable and demonstrable offline, and a scripted stream is the only way
 * the full render path gets exercised deterministically. Its tool calls are
 * real: the search it asks for runs against the local database, and the
 * edit it asks for runs the editing session.
 */
export function createMockLanguageModel(
  options: MockModelOptions = {}
): LanguageModelV3 {
  const delay = options.delayMs ?? 8;

  const script = (
    call: LanguageModelV3CallOptions
  ): LanguageModelV3StreamPart[] => {
    const { query, fullQuery, lastToolResult, openDocumentId } = readPrompt(
      call.prompt
    );
    const tools = new Set((call.tools ?? []).map((t) => t.name));
    const parts: LanguageModelV3StreamPart[] = [];

    const toolCall = (name: string, input: unknown) => {
      const id = `mock-${name}-1`;
      const json = JSON.stringify(input);
      parts.push(
        { type: 'tool-input-start', id, toolName: name },
        { type: 'tool-input-delta', id, delta: json },
        { type: 'tool-input-end', id },
        { type: 'tool-call', toolCallId: id, toolName: name, input: json }
      );
    };
    const text = (body: string) => {
      parts.push({ type: 'text-start', id: 'text-1' });
      for (const piece of pieces(body)) {
        parts.push({ type: 'text-delta', id: 'text-1', delta: piece });
      }
      parts.push({ type: 'text-end', id: 'text-1' });
    };
    const finish = (reason: 'stop' | 'tool-calls') =>
      parts.push({
        type: 'finish',
        finishReason: { unified: reason, raw: undefined },
        usage,
      });

    const edit = query.match(EDIT_COMMAND);

    // Inside the editing session the mock plays both of its agents: the
    // supervisor dispatches the whole request as one task, and the coder
    // answers a task by appending a paragraph that carries the task text.
    if (tools.has('dispatch')) {
      if (lastToolResult) {
        text('Applied edits.');
        finish('stop');
      } else {
        const request =
          fullQuery.match(/^Request:\s*(?:Request:\s*)?(.+)$/m)?.[1]?.trim() ??
          query;
        toolCall('dispatch', { editing_instruction: request });
        finish('tool-calls');
      }
      return parts;
    }
    if (tools.has('runCode')) {
      if (lastToolResult) {
        text('done');
        finish('stop');
      } else {
        const task = fullQuery.match(/<task>\s*([\s\S]*?)\s*<\/task>/)?.[1];
        toolCall('runCode', {
          code: 'editor.appendParagraph(snippets.text)',
          snippets: { text: task ?? 'Added by the assistant.' },
        });
        finish('tool-calls');
      }
      return parts;
    }

    if (!lastToolResult) {
      parts.push({ type: 'reasoning-start', id: 'think-1' });
      for (const piece of pieces(THINKING)) {
        parts.push({ type: 'reasoning-delta', id: 'think-1', delta: piece });
      }
      parts.push({ type: 'reasoning-end', id: 'think-1' });

      if (edit && openDocumentId && tools.has('EditDocument')) {
        toolCall('EditDocument', {
          document_id: openDocumentId,
          instructions: edit[1]!.trim(),
        });
        finish('tool-calls');
        return parts;
      }
      if (tools.has('ListFiles') && /\b(files?|folders?)\b/i.test(query)) {
        toolCall('ListFiles', {});
        finish('tool-calls');
        return parts;
      }
      if (tools.has('ContentSearch')) {
        toolCall('ContentSearch', { query });
        finish('tool-calls');
        return parts;
      }
      text(REPLY.replace('%QUERY%', query));
      finish('stop');
      return parts;
    }

    if (lastToolResult.toolName === 'EditDocument') {
      const summary =
        (lastToolResult.output as { summary?: string } | null)?.summary ??
        'done';
      text(`Edited the document: ${summary}`);
      finish('stop');
      return parts;
    }

    if (lastToolResult.toolName === 'ListFiles') {
      const entries =
        (lastToolResult.output as { entries?: { path: string }[] } | null)
          ?.entries ?? [];
      text(
        entries.length > 0
          ? `Your files:\n${entries.map((e) => `- ${e.path}`).join('\n')}\n`
          : 'You have no files yet.'
      );
      finish('stop');
      return parts;
    }

    let reply = REPLY.replace('%QUERY%', query);
    // Retrieval made visible: a real model would weave the results into its
    // answer; the mock proves they ARRIVED by listing their titles.
    const results = (
      lastToolResult.output as { results?: { name: string }[] } | null
    )?.results;
    if (results && results.length > 0) {
      reply += `\n> Sources: ${results.map((r) => r.name || 'Untitled').join(', ')}\n`;
    }
    text(reply);
    finish('stop');
    return parts;
  };

  return {
    specificationVersion: 'v3',
    provider: 'workbench-mock',
    modelId: 'mock',
    supportedUrls: {},
    async doGenerate(call) {
      const parts = script(call);
      const content: LanguageModelV3Content[] = [];
      for (const part of parts) {
        if (part.type === 'text-delta') {
          content.push({ type: 'text', text: part.delta });
        } else if (part.type === 'tool-call') {
          content.push({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          });
        }
      }
      const finishReason = parts.find((p) => p.type === 'finish');
      return {
        content,
        finishReason:
          finishReason?.type === 'finish'
            ? finishReason.finishReason
            : { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
    async doStream(call) {
      const parts = script(call);
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          async start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            for (const part of parts) {
              if (call.abortSignal?.aborted) break;
              controller.enqueue(part);
              if (
                part.type === 'text-delta' ||
                part.type === 'reasoning-delta'
              ) {
                await tick(delay);
              }
            }
            controller.close();
          },
        }),
      };
    },
  };
}
