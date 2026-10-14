/**
 * @file Node type to XML element.
 *
 * The element names are HTML-ish on purpose: the model already knows what
 * `<h2>`, `<ol>` and `<blockquote>` mean, so borrowing that vocabulary buys
 * comprehension for free instead of teaching it a private one.
 */
import type { SerializedLexicalNode } from 'lexical';
import { type Attributes, formatAttributes } from './codecs';

/** A serialized node as it actually arrives, with the fields we read. */
export type XmlNode = SerializedLexicalNode & {
  children?: XmlNode[];
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  start?: number;
  url?: string;
  language?: string;
  $?: { id?: unknown };
  [key: string]: unknown;
};

/** The element name for a node, or `null` to render children transparently. */
export function elementNameFor(node: XmlNode): string {
  switch (node.type) {
    case 'paragraph':
      return 'p';
    case 'heading':
      // heading nodes carry their level as a tag: h1, h2, h3...
      return typeof node.tag === 'string' ? node.tag : 'h1';
    case 'quote':
      return 'blockquote';
    case 'list':
      return node.listType === 'number' ? 'ol' : 'ul';
    case 'listitem':
      return 'li';
    case 'link':
    case 'autolink':
      return 'a';
    case 'linebreak':
      return 'br';
    case 'text':
      return 'text';
    case 'tab':
      return 'tab';
    default:
      // Everything else — including this vocabulary's own nodes — uses its
      // type string verbatim, so a new node is addressable the day it exists
      // without touching this file.
      return node.type;
  }
}

/** The attributes an element carries beyond its id. */
export function attributesFor(node: XmlNode): Attributes {
  const attributes: Attributes = {};

  switch (node.type) {
    case 'text':
      Object.assign(
        attributes,
        formatAttributes(typeof node.format === 'number' ? node.format : 0)
      );
      break;
    case 'link':
    case 'autolink':
      if (typeof node.url === 'string') attributes.href = node.url;
      break;
    case 'list':
      // Only a list that does not start at 1 needs to say so.
      if (typeof node.start === 'number' && node.start !== 1) {
        attributes.start = node.start;
      }
      break;
    case 'code':
      if (typeof node.language === 'string') {
        attributes.language = node.language;
      }
      break;
    case 'tablecell': {
      const colSpan = node.colSpan;
      const rowSpan = node.rowSpan;
      const width = node.width;
      if (typeof colSpan === 'number' && colSpan > 1) {
        attributes.colspan = colSpan;
      }
      if (typeof rowSpan === 'number' && rowSpan > 1) {
        attributes.rowspan = rowSpan;
      }
      if (typeof width === 'number') attributes.width = width;
      if (node.headerState === 1 || node.headerState === 3) {
        attributes.header = true;
      }
      break;
    }
    case 'resource-mention':
      if (typeof node.resourceId === 'string') {
        attributes.resource = node.resourceId;
      }
      if (typeof node.kind === 'string') attributes.kind = node.kind;
      if (typeof node.label === 'string') attributes.label = node.label;
      if (typeof node.display === 'string') attributes.display = node.display;
      break;
    case 'image':
    case 'video':
    case 'file':
      if (typeof node.hash === 'string') attributes.hash = node.hash;
      if (typeof node.alt === 'string') attributes.alt = node.alt;
      if (typeof node.fileName === 'string') attributes.name = node.fileName;
      break;
    case 'equation':
      if (typeof node.equation === 'string') {
        attributes.equation = node.equation;
      }
      if (node.inline === true) attributes.inline = true;
      break;
    case 'unknown-embed':
      if (typeof node.tag === 'string') attributes.tag = node.tag;
      break;
    default:
      break;
  }

  return attributes;
}

/**
 * Code blocks are stored as a run of highlight tokens, one node per token.
 * The model wants the source, not the tokenizer's opinion of it, so a code
 * block flattens its children back to raw text.
 */
export function flattensChildren(node: XmlNode): boolean {
  return node.type === 'code';
}

/** The raw text of a node's subtree, used when flattening. */
export function textOf(node: XmlNode): string {
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'linebreak') return '\n';
  if (!node.children) return '';
  return node.children.map(textOf).join('');
}
