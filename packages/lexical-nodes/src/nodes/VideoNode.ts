/**
 * @file A video in the document, referenced by content hash.
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

export type VideoInfo = MediaInfo & MediaDisplay & { controls: boolean };

export type SerializedVideoNode = Spread<
  { controls: boolean },
  SerializedMediaNode
>;

export type VideoDecoratorProps = MediaDecoratorProps & { controls: boolean };

export class VideoNode extends MediaNode<VideoDecoratorProps> {
  __controls: boolean;

  constructor(info: VideoInfo, key?: NodeKey) {
    super(info, key);
    this.__controls = info.controls;
  }

  static getType(): string {
    return 'video';
  }

  static clone(node: VideoNode): VideoNode {
    return new VideoNode(node.getVideoInfo(), node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__controls = prevNode.__controls;
  }

  static importJSON(serializedNode: SerializedVideoNode): VideoNode {
    const node = $createVideoNode(serializedNode).updateFromJSON(
      serializedNode
    );
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedVideoNode {
    return {
      ...super.exportJSON(),
      ...this.getVideoInfo(),
      type: 'video',
      version: 1,
    };
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      video: (domNode: HTMLElement) => {
        const hash = domNode.getAttribute('data-blob-hash');
        if (!hash) return null;
        return {
          conversion: () => ({
            node: $createVideoNode({
              hash,
              mime: domNode.getAttribute('type') ?? 'video/*',
              width: Number(domNode.getAttribute('width')) || 0,
              height: Number(domNode.getAttribute('height')) || 0,
              controls: domNode.hasAttribute('controls'),
            }),
          }),
          priority: 1,
        };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('video');
    element.setAttribute('data-blob-hash', this.__hash);
    element.setAttribute('type', this.__mime);
    if (this.__controls) element.setAttribute('controls', '');
    const { width, height } = this.getRenderedDimensions();
    if (width > 0) element.setAttribute('width', String(width));
    if (height > 0) element.setAttribute('height', String(height));
    return { element };
  }

  getVideoInfo(): VideoInfo {
    return { ...this.getMediaInfo(), controls: this.__controls };
  }

  hasControls(): boolean {
    return this.getLatest().__controls;
  }

  setControls(controls: boolean): this {
    const writable = this.getWritable();
    writable.__controls = controls;
    writable.__decorator = null;
    return writable;
  }

  protected decoratorKey() {
    return VideoNode;
  }

  protected decoratorProps(): VideoDecoratorProps {
    return {
      ...this.getMediaInfo(),
      controls: this.__controls,
      key: this.__key,
    };
  }

  declare decorate: () => DecoratorComponent<VideoDecoratorProps> | undefined;
}

export function $createVideoNode(info: VideoInfo): VideoNode {
  return $applyNodeReplacement(new VideoNode(info));
}

export function $isVideoNode(
  node: LexicalNode | null | undefined
): node is VideoNode {
  return node instanceof VideoNode;
}
