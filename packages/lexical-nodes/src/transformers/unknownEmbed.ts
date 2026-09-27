/**
 * @file Round-tripping unrecognised embeds.
 *
 * Registered LAST in every transformer list, so it only ever sees what
 * nothing else claimed. Its export is the point: it emits the raw source it
 * captured, byte for byte, so a document that passed through a build which
 * could not understand part of it comes out unchanged.
 */
import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import {
  $createUnknownEmbedNode,
  $isUnknownEmbedNode,
  UnknownEmbedNode,
} from '../nodes/UnknownEmbedNode';

/**
 * Any `<x-*>...</x-*>` tag this build does not have a transformer for, as
 * the whole line — the same footprint as the tags it stands in for, and for
 * the same reason (see `xmlMatcher`). A tag inside a sentence is not an
 * embed; it stays the text it was.
 */
export const I_UNKNOWN_EMBED: ElementTransformer = {
  dependencies: [UnknownEmbedNode],
  type: 'element',
  regExp: /^(<(x-[a-z0-9-]+)>(.*?)<\/\2>)\s*$/,
  export: (node: LexicalNode) => {
    if (!$isUnknownEmbedNode(node)) return null;
    return node.getRaw();
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parent.replace(
      $createUnknownEmbedNode({
        tag: match[2] ?? 'x-unknown',
        raw: match[1] ?? '',
      })
    );
  },
};
