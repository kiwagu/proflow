/**
 * @file Media over the blob store.
 *
 * The document references bytes by content hash and never by URL. This is not
 * a detail: a URL is a location, and a location goes stale, breaks when the
 * bucket moves, and leaks an origin into a document that may be exported. A
 * hash is what the bytes *are*, so the reference stays valid wherever the
 * bytes are stored.
 *
 * A displayable URL is therefore a transient object URL the decorator mints
 * from the blob store and revokes when it unmounts — it exists only inside a
 * render, never as a document value.
 */
import {
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from './DecoratorBlockNode';

/** What the document stores about a piece of media. */
export type MediaInfo = {
  /** SHA-256 of the bytes; the blob store's key. Empty while in flight. */
  hash: string;
  mime: string;
  /** Intrinsic dimensions, recorded at insert time. */
  width: number;
  height: number;
};

/** Display-only overrides; they never change what the bytes are. */
export type MediaDisplay = {
  scale?: number;
  constrainedWidth?: number;
  constrainedHeight?: number;
};

export type SerializedMediaNode = Spread<
  MediaInfo & MediaDisplay,
  SerializedDecoratorBlockNode
>;

export type MediaDecoratorProps = MediaInfo & MediaDisplay & { key: NodeKey };

export type Dimensions = { width: number; height: number };

/**
 * Fit intrinsic dimensions inside optional bounds, preserving aspect ratio.
 *
 * Specified rather than inherited, because the exact rounding and the
 * never-enlarge clamp are what make a resize idempotent — without the clamp,
 * re-opening a small image inside a wide column would silently upscale it and
 * the document would render differently than when it was written.
 */
export function fitDimensions(
  intrinsic: Dimensions,
  bounds: { maxWidth?: number; maxHeight?: number } = {}
): Dimensions {
  const { width, height } = intrinsic;
  // Nothing sensible to scale: hand back what we were given.
  if (width <= 0 || height <= 0) return { width, height };

  const ratios: number[] = [];
  if (bounds.maxWidth && bounds.maxWidth > 0) {
    ratios.push(bounds.maxWidth / width);
  }
  if (bounds.maxHeight && bounds.maxHeight > 0) {
    ratios.push(bounds.maxHeight / height);
  }
  // A missing constraint contributes no bound at all.
  if (ratios.length === 0) return { width, height };

  const scale = Math.min(...ratios);
  // Constraints shrink; they never enlarge.
  if (scale >= 1) return { width, height };

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export abstract class MediaNode<
  P extends MediaDecoratorProps = MediaDecoratorProps,
> extends DecoratorBlockNode<DecoratorComponent<P> | undefined> {
  __hash: string;
  __mime: string;
  __width: number;
  __height: number;
  __scale: number | undefined;
  __constrainedWidth: number | undefined;
  __constrainedHeight: number | undefined;

  /**
   * The resolved decorator, cached so a drag-resize does not rebuild the
   * component tree on every pointer move. Every setter that changes what is
   * rendered clears it.
   */
  __decorator: DecoratorComponent<P> | undefined | null = null;

  constructor(info: MediaInfo & MediaDisplay, key?: NodeKey) {
    super('', key);
    this.__hash = info.hash;
    this.__mime = info.mime;
    this.__width = info.width;
    this.__height = info.height;
    this.__scale = info.scale;
    this.__constrainedWidth = info.constrainedWidth;
    this.__constrainedHeight = info.constrainedHeight;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__hash = prevNode.__hash;
    this.__mime = prevNode.__mime;
    this.__width = prevNode.__width;
    this.__height = prevNode.__height;
    this.__scale = prevNode.__scale;
    this.__constrainedWidth = prevNode.__constrainedWidth;
    this.__constrainedHeight = prevNode.__constrainedHeight;
    this.__decorator = prevNode.__decorator;
  }

  getMediaInfo(): MediaInfo & MediaDisplay {
    return {
      hash: this.__hash,
      mime: this.__mime,
      width: this.__width,
      height: this.__height,
      ...(this.__scale === undefined ? {} : { scale: this.__scale }),
      ...(this.__constrainedWidth === undefined
        ? {}
        : { constrainedWidth: this.__constrainedWidth }),
      ...(this.__constrainedHeight === undefined
        ? {}
        : { constrainedHeight: this.__constrainedHeight }),
    };
  }

  getHash(): string {
    return this.getLatest().__hash;
  }

  setHash(hash: string): this {
    const writable = this.getWritable();
    writable.__hash = hash;
    writable.__decorator = null;
    return writable;
  }

  getMime(): string {
    return this.getLatest().__mime;
  }

  getIntrinsicDimensions(): Dimensions {
    const latest = this.getLatest();
    return { width: latest.__width, height: latest.__height };
  }

  /** The size this node should render at, applying its own constraints. */
  getRenderedDimensions(): Dimensions {
    const latest = this.getLatest();
    return fitDimensions(
      { width: latest.__width, height: latest.__height },
      {
        ...(latest.__constrainedWidth === undefined
          ? {}
          : { maxWidth: latest.__constrainedWidth }),
        ...(latest.__constrainedHeight === undefined
          ? {}
          : { maxHeight: latest.__constrainedHeight }),
      }
    );
  }

  setConstrainedDimensions(width?: number, height?: number): this {
    const writable = this.getWritable();
    writable.__constrainedWidth = width;
    writable.__constrainedHeight = height;
    writable.__decorator = null;
    return writable;
  }

  setScale(scale: number | undefined): this {
    const writable = this.getWritable();
    writable.__scale = scale;
    writable.__decorator = null;
    return writable;
  }

  updateDOM(): false {
    return false;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  /** The node class the decorator registry is keyed on. */
  protected abstract decoratorKey(): Parameters<typeof getDecorator>[0];

  /** Props handed to the decorator; subclasses add their own fields. */
  protected abstract decoratorProps(): P;

  decorate(): DecoratorComponent<P> | undefined {
    if (this.__decorator !== null) return this.__decorator;
    const decorator = getDecorator<P>(this.decoratorKey());
    if (!decorator) {
      this.__decorator = undefined;
      return undefined;
    }
    const props = this.decoratorProps();
    const bound = () => decorator(props);
    this.__decorator = bound as unknown as DecoratorComponent<P>;
    return this.__decorator;
  }

  abstract exportDOM(): DOMExportOutput;
}

export function $isMediaNode(
  node: LexicalNode | null | undefined
): node is MediaNode {
  return node instanceof MediaNode;
}
