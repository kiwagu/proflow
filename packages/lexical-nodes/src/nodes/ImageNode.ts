/**
 * @file An image in the document, referenced by content hash.
 */
import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type Spread,
} from 'lexical';
import type { DecoratorComponent } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import {
  type MediaDecoratorProps,
  type MediaDisplay,
  type MediaInfo,
  MediaNode,
  type SerializedMediaNode,
} from './MediaNode';

export type ImageInfo = MediaInfo & MediaDisplay & { alt: string };

export type SerializedImageNode = Spread<
  { alt: string },
  SerializedMediaNode
>;

export type ImageDecoratorProps = MediaDecoratorProps & { alt: string };

export class ImageNode extends MediaNode<ImageDecoratorProps> {
  __alt: string;

  constructor(info: ImageInfo, key?: NodeKey) {
    super(info, key);
    this.__alt = info.alt;
  }

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.getImageInfo(), node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__alt = prevNode.__alt;
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const node = $createImageNode(serializedNode).updateFromJSON(
      serializedNode
    );
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      ...this.getImageInfo(),
      type: 'image',
      version: 1,
    };
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      img: (domNode: HTMLElement) => {
        const hash = domNode.getAttribute('data-blob-hash');
        if (!hash) return null;
        return {
          conversion: () => ({
            node: $createImageNode({
              hash,
              mime: domNode.getAttribute('type') ?? 'image/*',
              width: Number(domNode.getAttribute('width')) || 0,
              height: Number(domNode.getAttribute('height')) || 0,
              alt: domNode.getAttribute('alt') ?? '',
            }),
          }),
          priority: 1,
        };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('img');
    element.setAttribute('data-blob-hash', this.__hash);
    element.setAttribute('alt', this.__alt);
    element.setAttribute('type', this.__mime);
    const { width, height } = this.getRenderedDimensions();
    if (width > 0) element.setAttribute('width', String(width));
    if (height > 0) element.setAttribute('height', String(height));
    return { element };
  }

  getImageInfo(): ImageInfo {
    return { ...this.getMediaInfo(), alt: this.__alt };
  }

  getAlt(): string {
    return this.getLatest().__alt;
  }

  setAlt(alt: string): this {
    const writable = this.getWritable();
    writable.__alt = alt;
    writable.__decorator = null;
    return writable;
  }

  getTextContent(): string {
    return this.__alt;
  }

  protected decoratorKey() {
    return ImageNode;
  }

  protected decoratorProps(): ImageDecoratorProps {
    return { ...this.getMediaInfo(), alt: this.__alt, key: this.__key };
  }

  declare decorate: () => DecoratorComponent<ImageDecoratorProps> | undefined;
}

export function $createImageNode(info: ImageInfo): ImageNode {
  return $applyNodeReplacement(new ImageNode(info));
}

export function $isImageNode(
  node: LexicalNode | null | undefined
): node is ImageNode {
  return node instanceof ImageNode;
}
