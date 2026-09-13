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
 * The matcher for an internal tag.
 *
 * Non-greedy and single-line: an internal tag is written on one line by
 * construction, and a greedy match would swallow everything between the first
 * open tag and the last close tag of a different one.
 */
export function xmlMatcher(tag: string): RegExp {
  return new RegExp(`<${tag}>(.*?)</${tag}>`);
}

/**
 * Parse an internal tag's JSON payload, or hand the whole thing to the
 * unknown-embed sink.
 *
 * Every internal transformer routes its failures here rather than throwing:
 * a malformed embed must survive the round trip as inert text the user can
 * see and repair. Losing it would be the one unacceptable outcome.
 */
export function parseXmlPayload<T>(
  parent: ElementNode,
  tag: string,
  match: string[],
  build: (data: Record<string, unknown>) => T | null
): T | null {
  const raw = match[0] ?? '';
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
    parent.append($createUnknownEmbedNode({ tag, raw }));
    return null;
  }
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
 * Internal mention form for CARD display: `<x-resource>{json}</x-resource>`
 * on its own line.
 *
 * Card mentions are block-level, so they need an element transformer; inline
 * ones are handled by the text-match rule below. The node is one class with a
 * `display` axis, but markdown export is reached by two different mechanisms
 * depending on whether the node sits in the block flow or inside a text run,
 * so both rules exist.
 */
export const I_RESOURCE_MENTION_CARD: ElementTransformer = {
  dependencies: [ResourceMentionNode, UnknownEmbedNode],
  type: 'element',
  regExp: xmlMatcher(RESOURCE_TAG),
  export: (node: LexicalNode) => {
    if (!$isResourceMentionNode(node)) return null;
    if (node.getDisplay() !== 'card') return null;
    return wrapXml(RESOURCE_TAG, JSON.stringify(node.getInfo()));
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parseXmlPayload(parent, RESOURCE_TAG, match, (data) => {
      const node = buildMention(data);
      if (!node) return null;
      return parent.append(node);
    });
  },
};

/** Internal mention form for INLINE display, mid-sentence. */
export const I_RESOURCE_MENTION: TextMatchTransformer = {
  dependencies: [ResourceMentionNode, UnknownEmbedNode],
  type: 'text-match',
  importRegExp: new RegExp(`<${RESOURCE_TAG}>(.*?)</${RESOURCE_TAG}>`),
  regExp: new RegExp(`<${RESOURCE_TAG}>(.*?)</${RESOURCE_TAG}>$`),
  export: (node: LexicalNode) => {
    if (!$isResourceMentionNode(node)) return null;
    if (node.getDisplay() !== 'inline') return null;
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

/**
 * External mention form: an ordinary markdown link.
 *
 * Lossy by design — outside this product a mention is just a link, and a
 * reader who has no access to the resource still gets the label.
 */
export const RESOURCE_LINK: TextMatchTransformer = {
  dependencies: [ResourceMentionNode],
  type: 'text-match',
  importRegExp: /\[([^\]]*)\]\(resource:\/\/([^\s)]+)\)/,
  regExp: /\[([^\]]*)\]\(resource:\/\/([^\s)]+)\)$/,
  export: (node: LexicalNode) => {
    if (!$isResourceMentionNode(node)) return null;
    return `[${node.getLabel()}](resource://${node.getResourceId()})`;
  },
  replace: (textNode, match) => {
    textNode.replace(
      $createResourceMentionNode({
        resourceId: match[2] ?? '',
        kind: 'document',
        label: match[1] ?? '',
        display: 'inline',
      })
    );
  },
  trigger: ')',
};
