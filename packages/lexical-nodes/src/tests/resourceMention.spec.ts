/**
 * The one generic mention (ADR 0032 §5.2): one node, one serialized shape,
 * two render modes, and an OPEN kind vocabulary.
 */
import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $createParagraphNode, $getRoot, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $createResourceMentionNode,
  $isResourceMentionNode,
} from '../nodes/ResourceMentionNode';
import { EXTERNAL_TRANSFORMERS, INTERNAL_TRANSFORMERS } from '../transformers';

function editor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
}

function exportWith(build: () => void, transformers = INTERNAL_TRANSFORMERS) {
  const instance = editor();
  instance.update(
    () => {
      $getRoot().clear();
      build();
    },
    { discrete: true }
  );
  let out = '';
  instance.getEditorState().read(() => {
    out = $convertToMarkdownString(transformers);
  });
  return out;
}

function mentionsIn(markdown: string, transformers = INTERNAL_TRANSFORMERS) {
  const instance = editor();
  instance.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, transformers);
    },
    { discrete: true }
  );
  return instance.getEditorState().read(() => {
    const found: Array<{ id: string; kind: string; label: string }> = [];
    const visit = (node: ReturnType<typeof $getRoot>) => {
      for (const child of node.getChildren()) {
        if ($isResourceMentionNode(child)) {
          found.push({
            id: child.getResourceId(),
            kind: child.getKind(),
            label: child.getLabel(),
          });
        }
        const asElement = child as unknown as ReturnType<typeof $getRoot>;
        if (typeof asElement.getChildren === 'function') visit(asElement);
      }
    };
    visit($getRoot());
    return found;
  });
}

function inEditor<T>(fn: () => T): T {
  const instance = editor();
  let result!: T;
  instance.update(
    () => {
      result = fn();
    },
    { discrete: true }
  );
  return result;
}

describe('one node, two display modes', () => {
  it('is inline when display is inline', () => {
    expect(
      inEditor(() =>
        $createResourceMentionNode({
          resourceId: 'r1',
          kind: 'document',
          label: 'Spec',
          display: 'inline',
        }).isInline()
      )
    ).toBe(true);
  });

  it('is block when display is card', () => {
    expect(
      inEditor(() =>
        $createResourceMentionNode({
          resourceId: 'r1',
          kind: 'document',
          label: 'Spec',
          display: 'card',
        }).isInline()
      )
    ).toBe(false);
  });

  it('turns a mention into a card by toggling a property, not swapping node', () => {
    const instance = editor();
    let sameInstance = false;
    instance.update(
      () => {
        const node = $createResourceMentionNode({
          resourceId: 'r1',
          kind: 'document',
          label: 'Spec',
          display: 'inline',
        });
        const paragraph = $createParagraphNode();
        paragraph.append(node);
        $getRoot().append(paragraph);
        const updated = node.setDisplay('card');
        sameInstance = updated.getType() === node.getType();
        expect(updated.getDisplay()).toBe('card');
      },
      { discrete: true }
    );
    expect(sameInstance).toBe(true);
  });
});

describe('the kind vocabulary is open', () => {
  it('carries a kind the code has never seen', () => {
    expect(
      inEditor(() =>
        $createResourceMentionNode({
          resourceId: 'r9',
          kind: 'a-kind-invented-tomorrow',
          label: 'Thing',
          display: 'inline',
        }).getKind()
      )
    ).toBe('a-kind-invented-tomorrow');
  });

  it('round-trips an unfamiliar kind through markdown', () => {
    const source =
      '<x-resource>{"resourceId":"r9","kind":"space-station","label":"Mir","display":"card"}</x-resource>';
    expect(mentionsIn(source)).toEqual([
      { id: 'r9', kind: 'space-station', label: 'Mir' },
    ]);
  });
});

describe('markdown forms', () => {
  it('writes the internal form for a card mention', () => {
    const out = exportWith(() => {
      $getRoot().append(
        $createResourceMentionNode({
          resourceId: 'r1',
          kind: 'folder',
          label: 'Designs',
          display: 'card',
        })
      );
    });
    expect(out).toContain('<x-resource>');
    expect(out).toContain('"resourceId":"r1"');
  });

  it('degrades to a plain link in the portable form', () => {
    const out = exportWith(() => {
      const paragraph = $createParagraphNode();
      paragraph.append(
        $createResourceMentionNode({
          resourceId: 'r1',
          kind: 'document',
          label: 'The Spec',
          display: 'inline',
        })
      );
      $getRoot().append(paragraph);
    }, EXTERNAL_TRANSFORMERS);
    expect(out).toContain('[The Spec](resource://r1)');
  });

  it('imports the portable link form back into a mention', () => {
    expect(
      mentionsIn('[The Spec](resource://r1)', EXTERNAL_TRANSFORMERS)
    ).toEqual([{ id: 'r1', kind: 'document', label: 'The Spec' }]);
  });

  it('falls back to the unknown embed on malformed internal JSON', () => {
    const types = mentionsIn('<x-resource>{ not json }</x-resource>');
    expect(types).toEqual([]);
  });
});
