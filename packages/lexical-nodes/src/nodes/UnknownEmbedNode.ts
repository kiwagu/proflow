/**
 * @file The forward-compatibility sink.
 *
 * A document written by a newer build can contain tags this build has never
 * heard of. The only acceptable behaviour is to carry them through untouched:
 * an editor that silently drops what it cannot render turns "open an old
 * client by accident" into data loss.
 *
 * So anything unrecognised becomes one of these — it holds the raw source text
 * verbatim and re-exports it byte for byte. It is also the failure sink for
 * malformed internal tags, which is why every other transformer names it as
 * its catch branch: a mangled `<x-image>` degrades to an inert placeholder the
 * user can see and repair, never to a parse error or a hole in the document.
 */
import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type DOMExportOutput,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export type UnknownEmbedInfo = {
  /** The tag name that was not recognised, for the placeholder to name. */
  tag: string;
  /** The original source text, preserved exactly. */
  raw: string;
};

export type SerializedUnknownEmbedNode = Spread<
  UnknownEmbedInfo,
  SerializedLexicalNode
>;

export type UnknownEmbedDecoratorProps = UnknownEmbedInfo & { key: NodeKey };

export class UnknownEmbedNode extends DecoratorNode<
  DecoratorComponent<UnknownEmbedDecoratorProps> | undefined
> {
  __tag: string;
  __raw: string;

  constructor(info: UnknownEmbedInfo, key?: NodeKey) {
    super(key);
    this.__tag = info.tag;
    this.__raw = info.raw;
  }

  static getType(): string {
    return 'unknown-embed';
  }

  static clone(node: UnknownEmbedNode): UnknownEmbedNode {
    return new UnknownEmbedNode(node.getInfo(), node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__tag = prevNode.__tag;
    this.__raw = prevNode.__raw;
  }

  static importJSON(
    serializedNode: SerializedUnknownEmbedNode
  ): UnknownEmbedNode {
    const node = $createUnknownEmbedNode({
      tag: serializedNode.tag,
      raw: serializedNode.raw,
    }).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  /**
   * Paired with `exportDOM` so a copy/paste round trip through HTML keeps the
   * raw source instead of degrading to the placeholder's rendered text —
   * which would defeat the whole point of this node.
   */
  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      span: (domNode: HTMLElement) => {
        const tag = domNode.getAttribute('data-unknown-embed');
        if (!tag) return null;
        return {
          conversion: () => ({
            node: $createUnknownEmbedNode({
              tag,
              raw: domNode.textContent ?? '',
            }),
          }),
          priority: 1,
        };
      },
    };
  }

  exportJSON(): SerializedUnknownEmbedNode {
    return {
      ...super.exportJSON(),
      ...this.getInfo(),
      type: 'unknown-embed',
      version: 1,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    element.setAttribute('data-unknown-embed', this.__tag);
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.setAttribute('data-unknown-embed', this.__tag);
    element.textContent = this.__raw;
    return { element };
  }

  updateDOM(): false {
    return false;
  }

  getInfo(): UnknownEmbedInfo {
    return { tag: this.__tag, raw: this.__raw };
  }

  getTag(): string {
    return this.getLatest().__tag;
  }

  /** The source text, returned exactly as it arrived. */
  getRaw(): string {
    return this.getLatest().__raw;
  }

  getTextContent(): string {
    return this.__raw;
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  decorate(): DecoratorComponent<UnknownEmbedDecoratorProps> | undefined {
    const decorator =
      getDecorator<UnknownEmbedDecoratorProps>(UnknownEmbedNode);
    if (!decorator) return undefined;
    const props = { ...this.getInfo(), key: this.__key };
    return () => decorator(props);
  }
}

export function $createUnknownEmbedNode(
  info: UnknownEmbedInfo
): UnknownEmbedNode {
  return $applyNodeReplacement(new UnknownEmbedNode(info));
}

export function $isUnknownEmbedNode(
  node: LexicalNode | null | undefined
): node is UnknownEmbedNode {
  return node instanceof UnknownEmbedNode;
}
