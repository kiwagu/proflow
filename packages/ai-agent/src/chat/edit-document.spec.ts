import { createMockLanguageModel } from '@workspace/ai-local';
import {
  createEditingSession,
  loadMarkdown,
  toSnapshot,
} from '@workspace/ai-ops/ai-toolkit';
import type { DocumentMeta, SerializedTree } from '@workspace/domain';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { describeDocument } from '../editing/run-edit';
import { createEditDocument } from './edit-document';

const meta: DocumentMeta = {
  id: 'd1',
  title: 'Notes',
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** The sandbox's own editor API run unsandboxed, for tests. */
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

describe('EditDocument on the mock model', () => {
  it('saves the edited document when no editor has it open', async () => {
    const session = createEditingSession();
    loadMarkdown(session, '# Notes\n\nA line.');
    const tree = toSnapshot(session) as unknown as SerializedTree;
    const saved: { markdown: string }[] = [];

    const mock = () => createMockLanguageModel({ delayMs: 0 });
    const edit = createEditDocument({
      documents: {
        writer: 'test',
        invalidate: () => {},
        create: async () => ok(meta),
        load: async () => ok({ meta, content: { tree, markdown: '' } }),
        save: async (input) => {
          saved.push(input);
          return ok(true);
        },
        rename: async () => ok(undefined),
        softDelete: async () => ok(undefined),
      },
      models: () => ({ supervisor: mock(), interpret: mock(), coding: mock }),
      runner: plainRunner,
    });

    const outcome = await edit({
      documentId: 'd1',
      instructions: 'add a closing thought',
    });
    expect(outcome.summary).toBe('Applied edits.');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.markdown).toContain('add a closing thought');
  });

  it('hands the operations to an open editor instead of saving', async () => {
    const session = createEditingSession();
    loadMarkdown(session, 'A line.');
    const tree = toSnapshot(session) as unknown as SerializedTree;
    let savedCount = 0;
    let offered = 0;
    const mock = () => createMockLanguageModel({ delayMs: 0 });
    const edit = createEditDocument({
      documents: {
        writer: 'test',
        invalidate: () => {},
        create: async () => ok(meta),
        load: async () => ok({ meta, content: { tree, markdown: '' } }),
        save: async () => {
          savedCount++;
          return ok(true);
        },
        rename: async () => ok(undefined),
        softDelete: async () => ok(undefined),
      },
      models: () => ({ supervisor: mock(), interpret: mock(), coding: mock }),
      runner: plainRunner,
      openEditor: {
        readState: async () => null,
        applyEdit: async (_id, result) => {
          offered = result.ops.length;
          return true;
        },
      },
    });
    await edit({ documentId: 'd1', instructions: 'append something' });
    expect(offered).toBeGreaterThan(0);
    expect(savedCount).toBe(0);
    // Sanity: the session state the applier was not given is still derivable.
    expect(describeDocument(tree as never)).toContain('A line.');
  });
});
