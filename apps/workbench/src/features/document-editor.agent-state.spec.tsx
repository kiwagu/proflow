/**
 * The editor side of the agent seam, over a REAL live editor.
 *
 * The subject is the resulting document, not the call: each case drives a
 * sequence of agent operations through the bridge and then asks the live
 * editor what it holds — which is the only thing that distinguishes this
 * path from the document-store fallback it exists to replace.
 */
import { Doc } from '@workspace/ai-ops/doc';
import { createDocumentEditor } from '@workspace/ai-ops/editor';
import {
  createEditingSession,
  loadSnapshot,
  toSnapshot,
} from '@workspace/ai-ops/ai-toolkit';
import type { EditOutcome } from '@workspace/ai-agent';
import {
  isWrapperWithIds,
  type LexicalWrapper,
  type LexicalWrapperWithMapping,
} from '@workspace/lexical-react';
import { DocumentView } from '@workspace/workbench-editor';
import { act, render } from '@testing-library/react';
import { $getRoot, type SerializedEditorState, UNDO_COMMAND } from 'lexical';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentSeam,
  createEditorDocumentBridge,
  type LiveDocument,
} from './document-editor.agent-state';

const DOCUMENT_ID = 'doc-open';
const OTHER_DOCUMENT_ID = 'doc-elsewhere';

/** Mounts the product's editing surface and hands back its live instance. */
function openEditor(markdown: string): LexicalWrapperWithMapping {
  let captured: LexicalWrapper | undefined;
  render(
    <DocumentView
      initialMarkdown={markdown}
      onWrapper={(wrapper) => {
        captured = wrapper;
      }}
    />
  );
  if (!captured || !isWrapperWithIds(captured)) {
    throw new Error('the editor mounted without an id mapping');
  }
  return captured;
}

function text(wrapper: LexicalWrapperWithMapping): string {
  return wrapper.editor.read(() => $getRoot().getTextContent());
}

/**
 * One agent editing session over a state, as the worker runs it: a headless
 * copy of the document, a sequence of operations against it, and the whole
 * resulting tree handed back.
 */
function runSession(
  state: SerializedEditorState,
  write: (editor: ReturnType<typeof createDocumentEditor>) => void
): EditOutcome {
  const session = createEditingSession();
  loadSnapshot(session, state);
  const ids = [...session.ids.idToNodeKeyMap.keys()];
  const editor = createDocumentEditor({
    validIds: ids,
    refs: Array.from({ length: 16 }, (_, index) => `agent-ref-${index}`),
  });
  write(editor);
  const ops = editor.drain();
  const doc = new Doc(session);
  for (const op of ops) doc.apply(op);
  return { ops, state: toSnapshot(session) };
}

/** The block ids of a state, in document order — the agent's addresses. */
function blockIds(state: SerializedEditorState): string[] {
  return state.root.children.map(
    (child) => (child as { $?: { id?: string } }).$?.id ?? ''
  );
}

describe('the agent bridge over a live editor', () => {
  let wrapper: LexicalWrapperWithMapping;
  let live: LiveDocument | null;
  let bridge: ReturnType<typeof createEditorDocumentBridge>;

  beforeEach(() => {
    wrapper = openEditor('# Title\n\nFirst paragraph.');
    live = {
      documentId: DOCUMENT_ID,
      editor: wrapper.editor,
      mapping: wrapper.mapping,
    };
    bridge = createEditorDocumentBridge(() => live);
  });

  it('names the document it holds, and nothing when it holds none', () => {
    expect(bridge.documentId()).toBe(DOCUMENT_ID);
    live = null;
    expect(bridge.documentId()).toBeNull();
    expect(bridge.readState(DOCUMENT_ID)).toBeNull();
  });

  it('reads the live instance, not the loaded markdown', () => {
    act(() => {
      wrapper.editor.update(
        () => {
          $getRoot().getLastChild()?.selectEnd();
        },
        { discrete: true }
      );
    });
    const state = bridge.readState(DOCUMENT_ID);
    expect(state).not.toBeNull();
    // Every block carries a durable id: that is what the agent addresses
    // nodes by, and reading without them would hand it an unusable document.
    expect(blockIds(state!).every((id) => id.length > 0)).toBe(true);
    expect(JSON.stringify(state)).toContain('First paragraph.');
  });

  it('the seam swaps the live editor under a registered bridge', () => {
    // The host registers ONE bridge for the surface's lifetime and pushes
    // the editor into the seam as it mounts and unmounts. A bridge that had
    // captured the editor instead would answer for an editor that is gone.
    const seam = createAgentSeam();
    expect(seam.bridge.documentId()).toBeNull();
    expect(seam.bridge.readState(DOCUMENT_ID)).toBeNull();

    seam.setLive({
      documentId: DOCUMENT_ID,
      editor: wrapper.editor,
      mapping: wrapper.mapping,
    });
    expect(seam.bridge.documentId()).toBe(DOCUMENT_ID);
    expect(seam.bridge.readState(DOCUMENT_ID)).not.toBeNull();

    seam.setLive(null);
    expect(seam.bridge.documentId()).toBeNull();
    expect(seam.bridge.readState(DOCUMENT_ID)).toBeNull();
  });

  it('reading does not look like the user typing', () => {
    // The surface schedules a save from the editor's update listener, so a
    // read that runs an update would make merely ASKING what the document
    // holds write it back — and, worse, mark a document the user only
    // opened as edited.
    let updates = 0;
    const stop = wrapper.editor.registerUpdateListener(
      ({ dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size > 0 || dirtyLeaves.size > 0) updates++;
      }
    );
    act(() => {
      expect(bridge.readState(DOCUMENT_ID)).not.toBeNull();
      expect(bridge.readState(DOCUMENT_ID)).not.toBeNull();
    });
    stop();
    expect(updates).toBe(0);
  });

  it('lands a sequence of operations in the document', () => {
    const before = bridge.readState(DOCUMENT_ID);
    expect(before).not.toBeNull();
    const [heading, paragraph] = blockIds(before!);

    const outcome = runSession(before!, (editor) => {
      editor.setText(heading!, 'Rewritten title');
      editor.appendText(paragraph!, ' Extended.');
      editor.insertParagraphAfter(paragraph!, 'A closing paragraph.');
    });

    let applied = false;
    act(() => {
      applied = bridge.applyEdit(DOCUMENT_ID, outcome, false);
    });

    expect(applied).toBe(true);
    const content = text(wrapper);
    expect(content).toContain('Rewritten title');
    expect(content).toContain('First paragraph. Extended.');
    expect(content).toContain('A closing paragraph.');
    expect(content).not.toContain('# Title');
    // The insert landed as its own block, in position, rather than being
    // folded into the paragraph it follows.
    const after = wrapper.editor.getEditorState().toJSON();
    expect(after.root.children).toHaveLength(3);
  });

  it('reconciles in place, keeping untouched blocks as the same nodes', () => {
    const before = bridge.readState(DOCUMENT_ID);
    const [heading, paragraph] = blockIds(before!);
    const keyBefore = wrapper.mapping.idToNodeKeyMap.get(paragraph!);

    const outcome = runSession(before!, (editor) => {
      editor.setText(heading!, 'Only the heading changed');
    });
    act(() => {
      bridge.applyEdit(DOCUMENT_ID, outcome, false);
    });

    // Same node, same DOM: a wholesale rebuild is what makes an AI edit
    // flash and drops the user's caret.
    expect(wrapper.mapping.idToNodeKeyMap.get(paragraph!)).toBe(keyBefore);
    expect(text(wrapper)).toContain('Only the heading changed');
  });

  it('refuses a foreign document and leaves the content untouched', () => {
    const before = bridge.readState(DOCUMENT_ID);
    const contentBefore = text(wrapper);
    const outcome = runSession(before!, (editor) => {
      editor.setText(blockIds(before!)[0]!, 'Should never land');
    });

    expect(bridge.readState(OTHER_DOCUMENT_ID)).toBeNull();
    let applied = true;
    act(() => {
      applied = bridge.applyEdit(OTHER_DOCUMENT_ID, outcome, false);
    });

    expect(applied).toBe(false);
    expect(text(wrapper)).toBe(contentBefore);
    expect(text(wrapper)).not.toContain('Should never land');
  });

  it('folds a whole session into one undo step', () => {
    const contentBefore = text(wrapper);
    const before = bridge.readState(DOCUMENT_ID);
    const [heading, paragraph] = blockIds(before!);

    // Progress as the session reports it: two interim results, then the
    // settled one.
    const first = runSession(before!, (editor) => {
      editor.setText(heading!, 'Draft title');
    });
    act(() => {
      expect(bridge.applyEdit(DOCUMENT_ID, first, true)).toBe(true);
    });
    const second = runSession(bridge.readState(DOCUMENT_ID)!, (editor) => {
      editor.appendText(paragraph!, ' Still writing.');
    });
    act(() => {
      expect(bridge.applyEdit(DOCUMENT_ID, second, true)).toBe(true);
    });
    const settled = runSession(bridge.readState(DOCUMENT_ID)!, (editor) => {
      editor.insertParagraphAfter(paragraph!, 'Finished.');
    });
    act(() => {
      expect(bridge.applyEdit(DOCUMENT_ID, settled, false)).toBe(true);
    });

    expect(text(wrapper)).toContain('Finished.');

    act(() => {
      wrapper.editor.dispatchCommand(UNDO_COMMAND, undefined);
    });

    // One undo, and the document is back where the session found it.
    expect(text(wrapper)).toBe(contentBefore);
  });
});
