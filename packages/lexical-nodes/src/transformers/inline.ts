/**
 * @file The helpers every internal transformer is built from.
 *
 * The internal markdown form of this vocabulary's own nodes is a single
 * XML-ish tag carrying JSON: `<x-image>{...}</x-image>`. One shape for all of
 * them, so a reader (human or model) can tell at a glance that a line is a
 * structured embed, and so the fallback path has exactly one pattern to
 * recognise when a tag turns out to be unknown or malformed.
 */
import type {
  ElementTransformer,
  TextMatchTransformer,
  Transformer,
} from '@lexical/markdown';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import {
  $createResourceMentionNode,
  $isResourceMentionNode,
  ResourceMentionNode,
} from '../nodes/ResourceMentionNode';
import {
  $createUnknownEmbedNode,
  UnknownEmbedNode,
} from '../nodes/UnknownEmbedNode';

/** Wrap a payload in an internal tag. */
export function wrapXml(tag: string, payload: string): string {
  return `<${tag}>${payload}</${tag}>`;
}

/**
 * The matcher for an internal tag written as a BLOCK: the tag is the whole
 * line.
 *
 * Anchored at both ends on purpose. Lexical's block import assumes an element
 * match sits at column 0 and cuts `match[0].length` characters off the START
 * of the line, so a rule that also matched mid-sentence would chop the words
 * before the tag and push the node to the end. A tag inside a sentence is
 * left to the text-match rules — or stays text, when the node is not one
 * that can sit in a text run.
 *
 * Non-greedy and single-line: an internal tag is written on one line by
 * construction, and a greedy match would swallow everything between the first
 * open tag and the last close tag of a different one.
 */
export function xmlMatcher(tag: string): RegExp {
  return new RegExp(`^<${tag}>(.*?)</${tag}>\\s*$`);
}

/**
 * Parse an internal tag's JSON payload into its node, or into the
 * unknown-embed sink.
 *
 * Every internal transformer routes its failures here rather than throwing:
 * a malformed embed must survive the round trip as inert text the user can
 * see and repair. Losing it would be the one unacceptable outcome. The
 * caller places whatever comes back; the sink is a block like the nodes it
 * stands in for, so it takes the same place.
 */
export function parseXmlPayload<T extends LexicalNode>(
  tag: string,
  match: string[],
  build: (data: Record<string, unknown>) => T | null
): T | UnknownEmbedNode {
  const raw = (match[0] ?? '').trimEnd();
  const payload = match[1] ?? '';
  try {
    const data: unknown = JSON.parse(payload);
    if (typeof data !== 'object' || data === null) {
      throw new Error(`<${tag}> payload is not an object`);
    }
    const built = build(data as Record<string, unknown>);
    if (built === null) throw new Error(`<${tag}> payload is incomplete`);
    return built;
  } catch {
    return $createUnknownEmbedNode({ tag, raw });
  }
}

/** Whether the children a block rule was handed still carry anything of the user's. */
function holdsContent(children: LexicalNode[]): boolean {
  return children.some(
    (child) => !$isTextNode(child) || child.getTextContentSize() > 0
  );
}

/**
 * Put a block node where the line's paragraph stands.
 *
 * On import the paragraph is the importer's own and `children` is the line's
 * emptied text, so the node takes the paragraph's place. While typing, the
 * markdown shortcut hands over the paragraph the user is in, with whatever
 * followed the tag still inside it as `children`: that content is theirs and
 * stays, so the node goes in front of it. The last line of the document is
 * kept as well, so the cursor has a paragraph to continue in. The text the
 * cursor sat in is about to go, so on the typing path the cursor is moved to
 * what follows the node.
 */
export function $placeBlock(
  parent: ElementNode,
  children: LexicalNode[],
  node: LexicalNode,
  isImport: boolean
): void {
  if (
    holdsContent(children) ||
    (!isImport && parent.getNextSibling() === null)
  ) {
    parent.insertBefore(node);
  } else {
    parent.replace(node);
  }
  if (!isImport) node.selectNext(0, 0);
}

/**
 * Put an inline node where the line's tag was: in front of whatever followed
 * it, inside the same paragraph. Same two callers as `$placeBlock`, same
 * reason for the cursor move.
 */
export function $placeInline(
  parent: ElementNode,
  children: LexicalNode[],
  node: LexicalNode,
  isImport: boolean
): void {
  const first = children[0];
  if (first) first.insertBefore(node);
  else parent.append(node);
  if (!isImport) node.selectNext(0, 0);
}

/**
 * Marks a transformer that may only run on import.
 *
 * Some rules are asymmetric on purpose: they recognise a form on the way in
 * but must never be chosen to produce it on the way out (the internal form
 * wins for export). Marking them keeps the markdown-shortcut plugin from
 * firing them while the user types.
 */
export type ConversionOnlyTransformer = Transformer & {
  conversionOnly?: true;
};

export function conversionOnly<T extends Transformer>(
  transformer: T
): T & { conversionOnly: true } {
  return { ...transformer, conversionOnly: true };
}

export function isConversionOnlyTransformer(transformer: Transformer): boolean {
  return (transformer as ConversionOnlyTransformer).conversionOnly === true;
}

/**
 * Preserve a deliberately blank line.
 *
 * Markdown collapses consecutive blank lines, but an editor document is WYSIWYG
 * and an empty paragraph the user made is content. Without this, opening and
 * saving a document quietly deletes their spacing.
 */
export const EMPTY_PARAGRAPH: ElementTransformer = {
  dependencies: [],
  type: 'element',
  regExp: /^<br>$/,
  export: (node: LexicalNode) => {
    if (node.getType() !== 'paragraph') return null;
    return node.getTextContent().trim() === '' ? '<br>' : null;
  },
  replace: (parent: ElementNode) => {
    parent.replace($createParagraphNode());
  },
};

/** A hard line break inside a block, written as `<br>` mid-line. */
export const LINE_BREAK: ElementTransformer = {
  dependencies: [],
  type: 'element',
  regExp: /<br\s*\/?>/,
  export: () => null,
  replace: (parent: ElementNode) => {
    parent.append($createLineBreakNode());
  },
};

const RESOURCE_TAG = 'x-resource';

function buildMention(
  data: Record<string, unknown>
): ReturnType<typeof $createResourceMentionNode> | null {
  if (typeof data.resourceId !== 'string' || !data.resourceId) return null;
  return $createResourceMentionNode({
    resourceId: data.resourceId,
    kind: String(data.kind ?? 'document'),
    label: String(data.label ?? ''),
    display: data.display === 'card' ? 'card' : 'inline',
    ...(data.params && typeof data.params === 'object'
      ? { params: data.params as Record<string, string> }
      : {}),
  });
}

/**
 * Internal mention form in the BLOCK flow: `<x-resource>{json}</x-resource>`
 * as the whole line.
 *
 * The node is one class with a `display` axis, but markdown reaches it by
 * two mechanisms depending on WHERE it sits — an element rule sees the
 * top-level nodes, a text-match rule sees the children of a text run — so
 * both rules exist, and each writes whatever mention it is shown. Which one
 * the line becomes on import is the node's own call: a card is a block and
 * takes the line; an inline chip written on a line of its own stays in the
 * paragraph, exactly as it would mid-sentence.
 */
export const I_RESOURCE_MENTION_BLOCK: ElementTransformer = {
  dependencies: [ResourceMentionNode, UnknownEmbedNode],
  type: 'element',
  regExp: xmlMatcher(RESOURCE_TAG),
  export: (node: LexicalNode) => {
    if (!$isResourceMentionNode(node)) return null;
    return wrapXml(RESOURCE_TAG, JSON.stringify(node.getInfo()));
  },
  replace: (parent: ElementNode, children, match: string[], isImport) => {
    const node = parseXmlPayload(RESOURCE_TAG, match, buildMention);
    if ($isResourceMentionNode(node) && node.isInline()) {
      $placeInline(parent, children, node, isImport);
    } else {
      $placeBlock(parent, children, node, isImport);
    }
  },
};

/** Internal mention form inside a text run, mid-sentence. */
export const I_RESOURCE_MENTION: TextMatchTransformer = {
  dependencies: [ResourceMentionNode, UnknownEmbedNode],
  type: 'text-match',
  importRegExp: new RegExp(`<${RESOURCE_TAG}>(.*?)</${RESOURCE_TAG}>`),
  regExp: new RegExp(`<${RESOURCE_TAG}>(.*?)</${RESOURCE_TAG}>$`),
  export: (node: LexicalNode) => {
    if (!$isResourceMentionNode(node)) return null;
    return wrapXml(RESOURCE_TAG, JSON.stringify(node.getInfo()));
  },
  replace: (textNode, match) => {
    try {
      const data: unknown = JSON.parse(match[1] ?? '');
      if (typeof data !== 'object' || data === null) throw new Error('bad');
      const node = buildMention(data as Record<string, unknown>);
      if (!node) throw new Error('incomplete');
      textNode.replace(node);
    } catch {
      textNode.replace(
        $createUnknownEmbedNode({
          tag: RESOURCE_TAG,
          raw: match[0] ?? '',
        })
      );
    }
  },
  trigger: '>',
};

const RESOURCE_LINK_REG_EXP = /\[([^\]]*)\]\(resource:\/\/([^\s)]+)\)/;

function portableLink(node: ResourceMentionNode): string {
  return `[${node.getLabel()}](resource://${node.getResourceId()})`;
}

/**
 * External mention form: an ordinary markdown link.
 *
 * Lossy by design — outside this product a mention is just a link, and a
 * reader who has no access to the resource still gets the label. The link
 * carries no display, so on import it is always the inline chip; a card is
 * something the author chooses in the editor.
 */
export const RESOURCE_LINK: TextMatchTransformer = {
  dependencies: [ResourceMentionNode],
  type: 'text-match',
  importRegExp: RESOURCE_LINK_REG_EXP,
  regExp: new RegExp(`${RESOURCE_LINK_REG_EXP.source}$`),
  export: (node: LexicalNode) => {
    if (!$isResourceMentionNode(node)) return null;
    return portableLink(node);
  },
  replace: (textNode, match) => {
    textNode.replace(portableMention(match));
  },
  trigger: ')',
};

/**
 * The same portable link for a mention in the BLOCK flow — a card, which
 * sits at the top level where only an element rule is asked. Without this
 * rule the portable export of a card would fall through to the node's text
 * content and hand the reader a bare label with nothing to follow.
 *
 * On import the whole-line form reads exactly as the text-match rule reads
 * it anywhere else: an inline chip in a paragraph.
 */
export const RESOURCE_LINK_BLOCK: ElementTransformer = {
  dependencies: [ResourceMentionNode],
  type: 'element',
  regExp: new RegExp(`^${RESOURCE_LINK_REG_EXP.source}\\s*$`),
  export: (node: LexicalNode) => {
    if (!$isResourceMentionNode(node)) return null;
    return portableLink(node);
  },
  replace: (parent: ElementNode, children, match: string[], isImport) => {
    $placeInline(parent, children, portableMention(match), isImport);
  },
};

function portableMention(match: string[]): ResourceMentionNode {
  return $createResourceMentionNode({
    resourceId: match[2] ?? '',
    kind: 'document',
    label: match[1] ?? '',
    display: 'inline',
  });
}
