import { createMockLanguageModel } from '@workspace/ai-local';
import type { DocumentMeta, FileNode, LlmChunk } from '@workspace/domain';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { createAgentGateway } from './agent';
import {
  createDocumentTools,
  type DocumentToolDeps,
  toFileListing,
} from './tools';

const meta = (id: string, title: string): DocumentMeta => ({
  id,
  title,
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const node = (
  id: string,
  name: string,
  parentId: string | null,
  kind: FileNode['kind'] = 'blob'
): FileNode => ({
  id,
  parentId,
  kind,
  name,
  mime: kind === 'blob' ? 'application/pdf' : null,
  size: kind === 'blob' ? 1234 : null,
  blobHash: kind === 'blob' ? 'hash' : null,
  documentId: kind === 'document' ? `doc-${id}` : null,
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const tree = [
  node('f1', 'Projects', null, 'folder'),
  node('f2', 'Alpha', 'f1', 'folder'),
  node('b1', 'spec.pdf', 'f2'),
  node('d1', 'Plan', 'f1', 'document'),
  node('b2', 'loose.pdf', null),
];

function fakeDeps(edits: string[]): DocumentToolDeps {
  return {
    documents: {
      writer: 'test',
      invalidate: () => {},
      create: async () => ok(meta('new', 'New')),
      load: async (id) =>
        ok({
          meta: meta(id, 'Notes'),
          content: { tree: { root: {} } as never, markdown: '# Notes' },
        }),
      save: async () => ok(true),
      rename: async () => ok(undefined),
      softDelete: async () => ok(undefined),
    },
    listDocuments: async () => [
      meta('d1', 'Meeting notes'),
      meta('d2', 'Ideas'),
    ],
    listFiles: async () => tree,
    search: {
      search: async () =>
        ok([
          { documentId: 'd1', title: 'Meeting notes', excerpt: '…', score: 1 },
        ]),
      indexDocument: async () => ok(undefined),
    },
    editDocument: async ({ instructions }) => {
      edits.push(instructions);
      return { summary: 'Added a paragraph.' };
    },
  };
}

async function collect(stream: AsyncIterable<LlmChunk>) {
  const chunks: LlmChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const gateway = (edits: string[] = []) =>
  createAgentGateway({
    model: () => createMockLanguageModel({ delayMs: 0 }),
    tools: createDocumentTools(fakeDeps(edits)),
  });

describe('the chat agent loop', () => {
  it('runs the search tool for real and answers with its results', async () => {
    const chunks = await collect(
      gateway().streamChat({
        model: 'mock',
        messages: [{ role: 'user', text: 'what did we decide?' }],
      })
    );
    const types = chunks.map((c) => c.type);
    expect(types).toContain('thinking');
    const call = chunks.find((c) => c.type === 'tool_call');
    expect(call).toMatchObject({ name: 'ContentSearch' });
    const result = chunks.find((c) => c.type === 'tool_result');
    expect(result).toMatchObject({ name: 'ContentSearch' });
    const text = chunks
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('');
    expect(text).toContain('Sources: Meeting notes');
    expect(types.at(-1)).toBe('done');
  });

  it('edits the open document when asked to', async () => {
    const edits: string[] = [];
    const chunks = await collect(
      gateway(edits).streamChat({
        model: 'mock',
        systemPrompt:
          'The user currently has the following items open:\n- Notes (md, id: d1)',
        messages: [{ role: 'user', text: 'edit: add a closing paragraph' }],
      })
    );
    expect(edits).toEqual(['add a closing paragraph']);
    expect(chunks.find((c) => c.type === 'tool_call')).toMatchObject({
      name: 'EditDocument',
      input: { document_id: 'd1' },
    });
    const text = chunks
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('');
    expect(text).toContain('Edited the document: Added a paragraph.');
  });
});

describe('the transcript sent to the model', () => {
  it('drops empty turns and merges the neighbours they leave', async () => {
    const seen: unknown[] = [];
    const model = createMockLanguageModel({ delayMs: 0 });
    const spy = {
      ...model,
      doStream: (call: Parameters<typeof model.doStream>[0]) => {
        seen.push(call.prompt);
        return model.doStream(call);
      },
    };
    await collect(
      createAgentGateway({ model: () => spy, tools: {} }).streamChat({
        model: 'mock',
        messages: [
          { role: 'user', text: 'first' },
          { role: 'assistant', text: '' },
          { role: 'user', text: 'second' },
        ],
      })
    );
    const prompt = seen[0] as { role: string; content: unknown }[];
    expect(prompt.map((m) => m.role)).toEqual(['user']);
    expect(JSON.stringify(prompt[0]!.content)).toContain('first\\n\\nsecond');
  });
});

describe('ListFiles', () => {
  const execute = async (input: { path?: string }) => {
    const tools = createDocumentTools(fakeDeps([]));
    return (await tools.ListFiles!.execute!(input, {
      toolCallId: 't',
      messages: [],
      context: undefined as never,
    })) as { entries: { path: string; documentId: string | null }[] };
  };

  it('lists the whole tree as rooted paths', async () => {
    const out = await execute({});
    expect(out.entries.map((e) => e.path)).toEqual([
      '/Projects',
      '/Projects/Alpha',
      '/Projects/Alpha/spec.pdf',
      '/Projects/Plan',
      '/loose.pdf',
    ]);
    const plan = out.entries.find((e) => e.path === '/Projects/Plan');
    expect(plan?.documentId).toBe('doc-d1');
  });

  it('narrows to a folder subtree', async () => {
    const out = await execute({ path: '/Projects/Alpha' });
    expect(out.entries.map((e) => e.path)).toEqual([
      '/Projects/Alpha',
      '/Projects/Alpha/spec.pdf',
    ]);
  });

  it('says so when a path has nothing under it', async () => {
    const out = await execute({ path: '/Nowhere' });
    expect(out).toMatchObject({ entries: [], note: 'Nothing under /Nowhere' });
  });

  it('runs end to end: the mock asks for files and reads out the paths', async () => {
    const chunks = await collect(
      gateway().streamChat({
        model: 'mock',
        messages: [{ role: 'user', text: 'what files do I have?' }],
      })
    );
    expect(chunks.find((c) => c.type === 'tool_call')).toMatchObject({
      name: 'ListFiles',
    });
    const text = chunks
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('');
    expect(text).toContain('/Projects/Alpha/spec.pdf');
  });
});

describe('toFileListing', () => {
  it('keeps an orphaned node addressable instead of dropping it', () => {
    const orphan = node('x', 'stray.pdf', 'gone');
    expect(toFileListing([orphan])[0]!.path).toBe('/stray.pdf');
  });
});

describe('CreateDocument', () => {
  it('parses the content locally and saves it, without a model', async () => {
    const saved: { markdown: string; tree: unknown }[] = [];
    const deps = fakeDeps([]);
    deps.documents.save = async (input) => {
      saved.push(input);
      return ok(true);
    };
    const tools = createDocumentTools(deps);
    const out = await tools.CreateDocument!.execute!(
      {
        documentName: 'Notes',
        fileContent: '# Title\n\nBody.',
        fileExtension: 'md',
      },
      { toolCallId: 't', messages: [], context: undefined as never }
    );
    expect(out).toEqual({ documentId: 'new' });
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0]!.tree)).toContain('"heading"');
  });
});
