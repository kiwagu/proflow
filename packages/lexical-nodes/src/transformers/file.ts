/**
 * @file Markdown forms for the file card.
 *
 * Two forms, as everywhere in this vocabulary: an internal one that
 * round-trips losslessly, and an external one that degrades to something any
 * markdown reader understands.
 */
import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createFileNode, $isFileNode, FileNode } from '../nodes/FileNode';
import { UnknownEmbedNode } from '../nodes/UnknownEmbedNode';
import { parseXmlPayload, wrapXml, xmlMatcher } from './inline';

const TAG = 'x-file';

/** Internal form: `<x-file>{json}</x-file>`, round-trips without loss. */
export const I_FILE: ElementTransformer = {
  dependencies: [FileNode, UnknownEmbedNode],
  type: 'element',
  regExp: xmlMatcher(TAG),
  export: (node: LexicalNode) => {
    if (!$isFileNode(node)) return null;
    // No hash yet: the bytes are still on their way; nothing to reference.
    if (!node.getHash()) return null;
    return wrapXml(TAG, JSON.stringify(node.getInfo()));
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parseXmlPayload(parent, TAG, match, (data) => {
      if (typeof data.hash !== 'string' || !data.hash) return null;
      return parent.append(
        $createFileNode({
          hash: data.hash,
          fileName: String(data.fileName ?? ''),
          mimeType: String(data.mimeType ?? 'application/octet-stream'),
          size: Number(data.size) || 0,
        })
      );
    });
  },
};

/** External form: a plain link to the file, readable anywhere. */
export const FILE_LINK: ElementTransformer = {
  dependencies: [FileNode],
  type: 'element',
  regExp: /^\[([^\]]*)\]\(blob:\/\/([0-9a-f]{64})\)$/,
  export: (node: LexicalNode) => {
    if (!$isFileNode(node) || !node.getHash()) return null;
    const info = node.getInfo();
    return `[${info.fileName}](blob://${info.hash})`;
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parent.append(
      $createFileNode({
        hash: match[2] ?? '',
        fileName: match[1] ?? '',
        mimeType: 'application/octet-stream',
        size: 0,
      })
    );
  },
};
