import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  createEditingSession,
  loadMarkdown,
  toSnapshot,
} from '@workspace/ai-ops/ai-toolkit';
import { serializeWithXml } from '@workspace/ai-ops/utils';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { describeDocument, runEditSession } from './run-edit';

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: 10,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A supervisor that dispatches one edit, then wraps up in text. */
function supervisorModel() {
  let step = 0;
  return new MockLanguageModelV3({
    modelId: 'supervisor-mock',
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          if (step++ === 0) {
            const input = JSON.stringify({
              editing_instruction: 'append a closing paragraph',
            });
            controller.enqueue({
              type: 'tool-input-start',
              id: 'call-1',
              toolName: 'dispatch',
            });
            controller.enqueue({
              type: 'tool-input-delta',
              id: 'call-1',
              delta: input,
            });
            controller.enqueue({ type: 'tool-input-end', id: 'call-1' });
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'dispatch',
              input,
            });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage,
            });
          } else {
            controller.enqueue({ type: 'text-start', id: 't1' });
            controller.enqueue({
              type: 'text-delta',
              id: 't1',
              delta: 'Added the paragraph.',
            });
            controller.enqueue({ type: 'text-end', id: 't1' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage,
            });
          }
          controller.close();
        },
      }),
    }),
  });
}

/** A coder that answers every task with one runCode call, then stops. */
function coderModel() {
  let calls = 0;
  return new MockLanguageModelV3({
    modelId: 'coder-mock',
    doGenerate: async () =>
      calls++ === 0
        ? {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'run-1',
                toolName: 'runCode',
                input: JSON.stringify({
                  code: 'editor.appendParagraph(snippets.closing)',
                  snippets: { closing: 'The end.' },
                }),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: undefined },
            usage,
            warnings: [],
          }
        : {
            content: [{ type: 'text' as const, text: 'done' }],
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage,
            warnings: [],
          },
  });
}

/** Snippet runner for tests: the sandbox's own editor API, unsandboxed. */
async function plainRunner(
  validIds: Set<string>,
  code: string,
  snippets?: Record<string, string>
) {
  const { createDocumentEditor } = await import('@workspace/ai-ops/editor');
  const editor = createDocumentEditor({
    validIds,
    refs: Array.from({ length: 16 }, (_, i) => `ref-${i}`),
  });
  new Function('editor', 'snippets', code)(editor, snippets ?? {});
  return editor.drain();
}

describe('runEditSession', () => {
  it('turns a prompt into operations and a new document state', async () => {
    const session = createEditingSession();
    loadMarkdown(session, '# Title\n\nFirst paragraph.');
    const state = toSnapshot(session);

    const result = await runEditSession({
      state,
      prompt: 'add a closing paragraph',
      models: {
        supervisor: supervisorModel(),
        interpret: supervisorModel(),
        coding: () => coderModel(),
      },
      runner: plainRunner,
    });

    expect(result.text).toBe('Added the paragraph.');
    expect(result.ops.map((op) => op.kind)).toContain('insertNode');
    expect(describeDocument(result.state)).toContain('The end.');
    // The input was not mutated: the session worked on its own copy.
    expect(serializeWithXml(session)).not.toContain('The end.');
  });
});
