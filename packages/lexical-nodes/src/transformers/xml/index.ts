/**
 * @file The document as XML, for the model.
 *
 * This is the agent's view of the document AND its address space: the `id`
 * attribute on an element here is the `{id}` an edit op targets. That makes
 * the id non-negotiable — an element without one is unaddressable, so any op
 * naming it would silently do nothing. We fail loudly instead.
 *
 * Built with a plain string builder over the serialized state. No XML
 * library: the output is a fixed contract with one consumer, and a library
 * would add a dependency and a layer of defaults between us and it.
 */
import type { SerializedEditorState } from 'lexical';
import { escapeText, renderAttributes } from './codecs';
import {
  attributesFor,
  elementNameFor,
  flattensChildren,
  type XmlNode,
  textOf,
} from './nodes';

export class MissingXmlIdError extends Error {
  constructor(type: string) {
    super(
      `node <${type}> has no stable id and cannot be addressed; ` +
        'the id plugin must run before the state is serialized for the model'
    );
    this.name = 'MissingXmlIdError';
  }
}

const INDENT = '  ';

function idOf(node: XmlNode): string {
  const id = node.$?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new MissingXmlIdError(node.type);
  }
  return id;
}

function renderNode(node: XmlNode, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  const name = elementNameFor(node);
  const attributes = renderAttributes({
    id: idOf(node),
    ...attributesFor(node),
  });

  // A text node's content is its value; there is nothing to nest.
  if (typeof node.text === 'string') {
    const body = escapeText(node.text);
    out.push(`${pad}<${name}${attributes}>${body}</${name}>`);
    return;
  }

  // Code keeps its source rather than its highlight tokens.
  if (flattensChildren(node)) {
    const body = escapeText(textOf(node));
    out.push(`${pad}<${name}${attributes}>${body}</${name}>`);
    return;
  }

  const children = node.children ?? [];
  if (children.length === 0) {
    out.push(`${pad}<${name}${attributes} />`);
    return;
  }

  out.push(`${pad}<${name}${attributes}>`);
  for (const child of children) renderNode(child, depth + 1, out);
  out.push(`${pad}</${name}>`);
}

/**
 * Render a serialized editor state as indented XML.
 *
 * The root itself is not addressable and carries no id — ops target its
 * children.
 */
export function toXml(state: SerializedEditorState): string {
  const root = state.root as unknown as XmlNode;
  const out: string[] = ['<root>'];
  for (const child of root.children ?? []) renderNode(child, 1, out);
  out.push('</root>');
  return out.join('\n');
}

export { MissingXmlIdError as MissingIdError };
export type { XmlNode };
