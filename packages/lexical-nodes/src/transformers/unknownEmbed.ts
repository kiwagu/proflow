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

/** Any `<x-*>...</x-*>` tag this build does not have a transformer for. */
export const I_UNKNOWN_EMBED: ElementTransformer = {
  dependencies: [UnknownEmbedNode],
  type: 'element',
  regExp: /<(x-[a-z0-9-]+)>(.*?)<\/\1>/,
  export: (node: LexicalNode) => {
    if (!$isUnknownEmbedNode(node)) return null;
    return node.getRaw();
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parent.append(
      $createUnknownEmbedNode({
        tag: match[1] ?? 'x-unknown',
        raw: match[0] ?? '',
      })
    );
  },
};
