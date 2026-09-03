/**
 * The model's view of the document (ADR 0032 §5.6). These are golden tests:
 * the output shape is a behaviour contract with the agent layer, whose edit
 * ops address nodes by the `id` attribute emitted here.
 */
import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $createParagraphNode, $getRoot, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $updateAllNodeIds,
  createNodeIdMappings,
  nodeIdPlugin,
} from '../plugins/nodeIdPlugin';
import { INTERNAL_TRANSFORMERS } from '../transformers';
import { MissingXmlIdError, toXml } from '../transformers/xml';

function xmlOf(markdown: string): string {
  const editor: LexicalEditor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
  const ids = createNodeIdMappings();
  nodeIdPlugin({ nodes: SupportedNodeTypes, mappings: ids })(editor);

  editor.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
    },
    { discrete: true }
  );
  editor.update(
    () => {
      $updateAllNodeIds(ids);
    },
    { discrete: true }
  );

  return toXml(editor.getEditorState().toJSON());
}

/** Replace the generated ids so the shape can be asserted exactly. */
function stable(xml: string): string {
  let counter = 0;
  const seen = new Map<string, string>();
  return xml.replace(/id="([^"]+)"/g, (_match, id: string) => {
    if (!seen.has(id)) seen.set(id, `id${++counter}`);
    return `id="${seen.get(id)}"`;
  });
}

describe('element vocabulary', () => {
  it('renders a heading and a paragraph', () => {
    expect(stable(xmlOf('## Notes\n\nSome text.'))).toBe(
      [
        '<root>',
        '  <h2 id="id1">',
        '    <text id="id2">Notes</text>',
        '  </h2>',
        '  <p id="id3">',
        '    <text id="id4">Some text.</text>',
        '  </p>',
        '</root>',
      ].join('\n')
    );
  });

  it('nests list items inside the list', () => {
    const xml = xmlOf('- one\n- two');
    expect(xml).toContain('<ul');
    expect(xml).toContain('<li');
  });

  it('marks an ordered list', () => {
    const xml = xmlOf('1. one\n2. two');
    expect(xml).toContain('<ol');
    expect(xml).not.toContain('<ul');
  });

  it('renders a quote', () => {
    expect(xmlOf('> quoted')).toContain('<blockquote');
  });

  it('renders a table', () => {
    expect(xmlOf('| a | b |\n| --- | --- |\n| c | d |')).toContain('<table');
  });
});

describe('addressability', () => {
  it('gives every element an id attribute', () => {
    const xml = xmlOf('# Title\n\nBody\n\n- item');
    const elements = xml.match(/<[a-z][a-z0-9-]*/gi) ?? [];
    // Every opening tag except the root carries an id.
    const withId = xml.match(/<[a-z][a-z0-9-]*[^>]*\sid="/gi) ?? [];
    expect(withId.length).toBe(elements.length - 1);
  });

  it('fails loudly rather than emitting an unaddressable element', () => {
    // A tree that never went through the id pass.
    const state = {
      root: {
        type: 'root',
        children: [{ type: 'paragraph', children: [], version: 1 }],
        version: 1,
      },
    } as unknown as Parameters<typeof toXml>[0];

    expect(() => toXml(state)).toThrow(MissingXmlIdError);
  });
});

describe('text and formatting', () => {
  it('emits formatting as attributes on the text element', () => {
    const xml = xmlOf('**bold** and *italic*');
    expect(xml).toContain('bold="true"');
    expect(xml).toContain('italic="true"');
  });

  it('escapes markup characters in text', () => {
    const xml = xmlOf('a < b & c');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&amp;');
  });

  it('carries a link target', () => {
    expect(xmlOf('[the docs](https://example.com)')).toContain(
      'href="https://example.com"'
    );
  });
});

describe('code blocks', () => {
  it('flattens highlight tokens back to raw source', () => {
    const xml = xmlOf('```js\nconst x = 1;\n```');
    expect(xml).toContain('<code');
    expect(xml).toContain('const x = 1;');
    // The per-token highlight children are not part of the model's view.
    expect(xml).not.toContain('code-highlight');
  });
});

describe('empty elements', () => {
  it('self-closes an element with no children', () => {
    const editor: LexicalEditor = createHeadlessEditor({
      nodes: [...SupportedNodeTypes],
      onError: (error) => {
        throw error;
      },
    });
    const ids = createNodeIdMappings();
    nodeIdPlugin({ nodes: SupportedNodeTypes, mappings: ids })(editor);

    editor.update(
      () => {
        $getRoot().clear();
        // A deliberately blank paragraph — spacing the author made.
        $getRoot().append($createParagraphNode());
      },
      { discrete: true }
    );
    editor.update(
      () => {
        $updateAllNodeIds(ids);
      },
      { discrete: true }
    );

    const xml = toXml(editor.getEditorState().toJSON());
    expect(xml).toMatch(/<p[^>]*\/>/);
  });
});
