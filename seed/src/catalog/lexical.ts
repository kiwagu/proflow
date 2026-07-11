/**
 * Minimal Lexical document builder for seed bodies. The `bodies` richText field
 * accepts a Lexical editor state; the seed only needs prose (headings +
 * paragraphs), so this builds the smallest valid tree the editor round-trips.
 * Real bodies (not the empty default) are what make the seed self-documenting.
 */

type LexicalNode = Record<string, unknown>;

function textNode(text: string): LexicalNode {
  return {
    type: 'text',
    text,
    format: 0,
    detail: 0,
    mode: 'normal',
    style: '',
    version: 1,
  };
}

function paragraph(text: string): LexicalNode {
  return {
    type: 'paragraph',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    textFormat: 0,
    children: text ? [textNode(text)] : [],
  };
}

function heading(text: string): LexicalNode {
  return {
    type: 'heading',
    tag: 'h2',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [textNode(text)],
  };
}

export type LexicalBlock = { heading: string } | { paragraph: string };

/** Build a Lexical editor state from heading/paragraph blocks. */
export function lexicalDoc(blocks: LexicalBlock[]): unknown {
  const children = blocks.map((b) =>
    'heading' in b ? heading(b.heading) : paragraph(b.paragraph)
  );
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: children.length > 0 ? children : [paragraph('')],
    },
  };
}

/** Shorthand: a body of plain paragraphs (one entry = one paragraph). */
export function prose(...paragraphs: string[]): unknown {
  return lexicalDoc(paragraphs.map((p) => ({ paragraph: p })));
}
