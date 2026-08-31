import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createFileNode, $isFileNode, FileNode } from '../nodes/FileNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

/** Internal form: `<m-file>{json}</m-file>`, round-trips without loss. */
export const I_FILE: ElementTransformer = {
  dependencies: [FileNode, UnknownMentionNode],
  type: 'element',
  regExp: /<m-file>(.*?)<\/m-file>/,
  export: (node: LexicalNode) => {
    if (!$isFileNode(node)) return null;
    // No hash yet: the bytes are still on their way; nothing to reference.
    if (!node.getHash()) return null;
    return `<m-file>${JSON.stringify(node.getInfo())}</m-file>`;
  },
  replace: (parent: ElementNode, _, match: string[]) => {
    try {
      const data = JSON.parse(match[1] ?? '');
      if (typeof data.hash !== 'string' || !data.hash) {
        throw new Error('Missing or invalid hash field');
      }
      parent.append(
        $createFileNode({
          hash: data.hash,
          fileName: String(data.fileName ?? ''),
          mimeType: String(data.mimeType ?? 'application/octet-stream'),
          size: Number(data.size) || 0,
        })
      );
    } catch (e) {
      console.error('Failed to parse m-file:', e);
      replaceElementWithUnknownMention(parent, 'Unknown File');
    }
  },
};

/** External form: a plain link to the file, readable anywhere. */
export const FILE_LINK: ElementTransformer = {
  dependencies: [FileNode],
  type: 'element',
  regExp: /^\[([^\]]*)\]\(pero-blob:\/\/([0-9a-f]{64})\)$/,
  export: (node: LexicalNode) => {
    if (!$isFileNode(node) || !node.getHash()) return null;
    const info = node.getInfo();
    return `[${info.fileName}](pero-blob://${info.hash})`;
  },
  replace: (parent: ElementNode, _, match: string[]) => {
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
