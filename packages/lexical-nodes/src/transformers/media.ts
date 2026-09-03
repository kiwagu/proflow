/**
 * @file Markdown forms for media.
 *
 * The internal forms carry the hash and the display constraints so a document
 * round-trips exactly. The external forms are standard markdown, and they
 * carry a `blob://` URL because a content hash is the only durable thing we
 * have to put in a link — an http URL would be a location that outlives its
 * validity.
 */
import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createImageNode, $isImageNode, ImageNode } from '../nodes/ImageNode';
import { UnknownEmbedNode } from '../nodes/UnknownEmbedNode';
import { $createVideoNode, $isVideoNode, VideoNode } from '../nodes/VideoNode';
import { parseXmlPayload, wrapXml, xmlMatcher } from './inline';

const IMAGE_TAG = 'x-image';
const VIDEO_TAG = 'x-video';

/** Internal image form: lossless, carries constraints. */
export const I_IMAGE: ElementTransformer = {
  dependencies: [ImageNode, UnknownEmbedNode],
  type: 'element',
  regExp: xmlMatcher(IMAGE_TAG),
  export: (node: LexicalNode) => {
    if (!$isImageNode(node)) return null;
    if (!node.getHash()) return null;
    return wrapXml(IMAGE_TAG, JSON.stringify(node.getImageInfo()));
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parseXmlPayload(parent, IMAGE_TAG, match, (data) => {
      if (typeof data.hash !== 'string' || !data.hash) return null;
      return parent.append(
        $createImageNode({
          hash: data.hash,
          mime: String(data.mime ?? 'image/*'),
          width: Number(data.width) || 0,
          height: Number(data.height) || 0,
          alt: String(data.alt ?? ''),
          ...(data.constrainedWidth === undefined
            ? {}
            : { constrainedWidth: Number(data.constrainedWidth) || undefined }),
          ...(data.constrainedHeight === undefined
            ? {}
            : {
                constrainedHeight:
                  Number(data.constrainedHeight) || undefined,
              }),
          ...(data.scale === undefined
            ? {}
            : { scale: Number(data.scale) || undefined }),
        })
      );
    });
  },
};

/** Internal video form. */
export const I_VIDEO: ElementTransformer = {
  dependencies: [VideoNode, UnknownEmbedNode],
  type: 'element',
  regExp: xmlMatcher(VIDEO_TAG),
  export: (node: LexicalNode) => {
    if (!$isVideoNode(node)) return null;
    if (!node.getHash()) return null;
    return wrapXml(VIDEO_TAG, JSON.stringify(node.getVideoInfo()));
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parseXmlPayload(parent, VIDEO_TAG, match, (data) => {
      if (typeof data.hash !== 'string' || !data.hash) return null;
      return parent.append(
        $createVideoNode({
          hash: data.hash,
          mime: String(data.mime ?? 'video/*'),
          width: Number(data.width) || 0,
          height: Number(data.height) || 0,
          controls: data.controls !== false,
        })
      );
    });
  },
};

/**
 * External image form: standard `![alt](blob://hash)`.
 *
 * An ELEMENT transformer, not a text-match one: the image node is
 * block-level, and a text-match rule only ever replaces an inline text node,
 * so it would never fire for this node on export.
 *
 * Registered AFTER the internal image transformer, which it is the fallback
 * for. A plain `![alt](http://...)` also matches here: the hash is left empty
 * and the app's ingest path (fetch, store, hash) fills it in, so an image
 * pasted from the web becomes owned bytes rather than a hotlink.
 */
export const IMAGE_LINK: ElementTransformer = {
  dependencies: [ImageNode],
  type: 'element',
  regExp: /^!\[([^\]]*)\]\((blob:\/\/[0-9a-f]{64}|https?:\/\/[^\s)]+)\)$/,
  export: (node: LexicalNode) => {
    if (!$isImageNode(node)) return null;
    // Bytes still in flight: there is nothing stable to reference, and a
    // half-written reference is worse than omitting the node.
    const hash = node.getHash();
    if (!hash) return null;
    return `![${node.getAlt()}](blob://${hash})`;
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    const alt = match[1] ?? '';
    const target = match[2] ?? '';
    const hash = target.startsWith('blob://')
      ? target.slice('blob://'.length)
      : '';
    parent.append(
      $createImageNode({
        hash,
        mime: 'image/*',
        width: 0,
        height: 0,
        alt,
      })
    );
  },
};

/** External video form: a plain link; markdown has no video syntax. */
export const VIDEO_LINK: ElementTransformer = {
  dependencies: [VideoNode],
  type: 'element',
  regExp: /^\[([^\]]*)\]\(blob:\/\/([0-9a-f]{64})\)$/,
  export: (node: LexicalNode) => {
    if (!$isVideoNode(node)) return null;
    const hash = node.getHash();
    if (!hash) return null;
    return `[video](blob://${hash})`;
  },
  replace: (parent: ElementNode, _children, match: string[]) => {
    parent.append(
      $createVideoNode({
        hash: match[2] ?? '',
        mime: 'video/*',
        width: 0,
        height: 0,
        controls: true,
      })
    );
  },
};
