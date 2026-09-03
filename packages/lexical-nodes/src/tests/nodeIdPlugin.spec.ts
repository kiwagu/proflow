/**
 * Durable node ids — the five behaviours ADR 0032 §5.1 names, plus the
 * serialization contract the sync layer depends on.
 */
import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $getId,
  $pruneNodeIds,
  $setId,
  $updateAllNodeIds,
  createNodeIdMappings,
  type NodeIdMappings,
  nodeIdPlugin,
} from '../plugins/nodeIdPlugin';
import { INTERNAL_TRANSFORMERS } from '../transformers';

function session(): { editor: LexicalEditor; ids: NodeIdMappings } {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
  const ids = createNodeIdMappings();
  nodeIdPlugin({ nodes: SupportedNodeTypes, mappings: ids })(editor);
  return { editor, ids };
}

function edit(editor: LexicalEditor, fn: () => void): void {
  editor.update(fn, { discrete: true });
}

describe('assign on sight', () => {
  it('gives every new node an id', () => {
    const { editor } = session();
    edit(editor, () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('hello'));
      $getRoot().append(paragraph);
    });

    editor.getEditorState().read(() => {
      for (const child of $getRoot().getChildren()) {
        expect($getId(child)).toBeTruthy();
      }
    });
  });

  it('records both map directions', () => {
    const { editor, ids } = session();
    edit(editor, () => {
      $getRoot().append($createParagraphNode());
    });

    const [key, id] = [...ids.nodeKeyToIdMap.entries()][0] ?? [];
    expect(key).toBeDefined();
    expect(id).toBeDefined();
    expect(ids.idToNodeKeyMap.get(id!)).toBe(key);
  });

  it('mints ids of one consistent length', () => {
    const { editor } = session();
    edit(editor, () => {
      const root = $getRoot();
      root.append($createParagraphNode(), $createParagraphNode());
    });

    editor.getEditorState().read(() => {
      const lengths = new Set(
        $getRoot()
          .getChildren()
          .map((child) => ($getId(child) ?? '').length)
      );
      expect([...lengths]).toEqual([11]);
    });
  });
});

describe('serialization', () => {
  it('survives an export/import round trip', () => {
    const { editor } = session();
    edit(editor, () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('durable'));
      $getRoot().append(paragraph);
    });

    const before = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((child) => $getId(child))
    );

    const json = editor.getEditorState().toJSON();

    const { editor: reopened } = session();
    reopened.setEditorState(reopened.parseEditorState(json));

    const after = reopened.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((child) => $getId(child))
    );

    expect(after).toEqual(before);
  });

  it('writes the id where the sync layer reads it, under `$`', () => {
    const { editor } = session();
    edit(editor, () => {
      $getRoot().append($createParagraphNode());
    });

    const json = editor.getEditorState().toJSON();
    const first = json.root.children[0] as { $?: { id?: unknown } };
    expect(typeof first.$?.id).toBe('string');
  });
});

describe('collision repair', () => {
  it('diverges two nodes that carry the same id', () => {
    const { editor, ids } = session();

    edit(editor, () => {
      $getRoot().append($createParagraphNode(), $createParagraphNode());
    });

    const original = editor
      .getEditorState()
      .read(() => $getId($getRoot().getFirstChild()));
    expect(original).toBeTruthy();

    // Force the second node to claim the first node's id, which is exactly
    // what a pasted copy of a subtree does.
    edit(editor, () => {
      const second = $getRoot().getLastChild();
      if (second) $setId(second, original!);
    });

    // The transform sees an id already mapped to a different key and mints a
    // fresh one for the newcomer.
    edit(editor, () => {
      $updateAllNodeIds(ids);
    });

    const all = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((child) => $getId(child))
    );

    expect(all).toHaveLength(2);
    expect(all[0]).toBe(original);
    expect(all[1]).not.toBe(original);
    expect(new Set(all).size).toBe(2);
  });
});

describe('map maintenance', () => {
  it('drops the entry for a node that left the document', () => {
    const { editor, ids } = session();

    edit(editor, () => {
      $getRoot().append($createParagraphNode(), $createParagraphNode());
    });

    const id = editor
      .getEditorState()
      .read(() => $getId($getRoot().getFirstChild()));
    expect(id).toBeTruthy();
    expect(ids.idToNodeKeyMap.has(id!)).toBe(true);

    edit(editor, () => {
      $getRoot().getFirstChild()?.remove();
    });

    // Headless Lexical has no mutation listeners, so a headless host that
    // keeps a long-lived map sweeps it explicitly.
    edit(editor, () => {
      $pruneNodeIds(ids);
    });

    expect(ids.idToNodeKeyMap.has(id!)).toBe(false);
    expect(ids.nodeKeyToIdMap.size).toBe(ids.idToNodeKeyMap.size);
  });

  it('keeps the map consistent in both directions', () => {
    const { editor, ids } = session();

    edit(editor, () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('text'));
      $getRoot().append(paragraph);
    });
    edit(editor, () => {
      $updateAllNodeIds(ids);
    });

    for (const [key, id] of ids.nodeKeyToIdMap) {
      expect(ids.idToNodeKeyMap.get(id)).toBe(key);
    }
  });
});

describe('bulk initialization', () => {
  it('ids a tree imported from markdown', () => {
    const { editor, ids } = session();

    edit(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString(
        '# Title\n\nA paragraph.\n\n- one\n- two',
        INTERNAL_TRANSFORMERS
      );
    });

    edit(editor, () => {
      $updateAllNodeIds(ids);
    });

    editor.getEditorState().read(() => {
      const missing: string[] = [];
      const visit = (node: ReturnType<typeof $getRoot>) => {
        for (const child of node.getChildren()) {
          if (!$getId(child)) missing.push(child.getType());
          const asElement = child as unknown as ReturnType<typeof $getRoot>;
          if (typeof asElement.getChildren === 'function') visit(asElement);
        }
      };
      visit($getRoot());
      expect(missing).toEqual([]);
    });
  });

  it('produces a tree every node of which the sync layer can address', () => {
    const { editor, ids } = session();

    edit(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString('# Heading\n\nBody text.', INTERNAL_TRANSFORMERS);
    });
    edit(editor, () => {
      $updateAllNodeIds(ids);
    });

    // The sync layer's rule: every serialized node carries `$.id`.
    const json = editor.getEditorState().toJSON();
    const check = (node: { $?: { id?: unknown }; children?: unknown[] }) => {
      expect(typeof node.$?.id).toBe('string');
      for (const child of (node.children ?? []) as Array<typeof node>) {
        check(child);
      }
    };
    for (const child of json.root.children as Array<{
      $?: { id?: unknown };
      children?: unknown[];
    }>) {
      check(child);
    }
  });
});
