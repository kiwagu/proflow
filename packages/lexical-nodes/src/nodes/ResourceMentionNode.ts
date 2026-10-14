/**
 * @file The one mention node.
 *
 * A reference from inside a document to a knowledge-base resource. One node,
 * one serialized shape, two render modes — deliberately, because the
 * alternative is a node class per referent kind, and that design cannot
 * represent a kind that did not exist when the code was written.
 *
 * `kind` is therefore an open string, not a union: the kind vocabulary is
 * data, and a mention that cannot carry a new kind would force a code change
 * every time the vocabulary grows.
 *
 * `display` is likewise an axis on one node rather than two node classes: an
 * inline chip and a block card differ only in `isInline()` and their
 * decorator, so "turn this mention into a card" stays a property toggle
 * instead of a node swap.
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

export type ResourceMentionDisplay = 'inline' | 'card';

export type ResourceMentionInfo = {
  /** Entity id of the referenced resource. */
  resourceId: string;
  /** Resource kind — open vocabulary, e.g. 'document', 'folder', 'file'. */
  kind: string;
  /**
   * Display text captured at insert time. A *cache*, not the authority: the
   * decorator resolves the live title from the local store and falls back to
   * this only when the resource is missing or not yet synced.
   */
  label: string;
  display: ResourceMentionDisplay;
  /** Render parameters, used by card mode. */
  params?: Record<string, string>;
};

export type SerializedResourceMentionNode = Spread<
  ResourceMentionInfo,
  SerializedLexicalNode
>;

export type ResourceMentionDecoratorProps = ResourceMentionInfo & {
  key: NodeKey;
};

export class ResourceMentionNode extends DecoratorNode<
  DecoratorComponent<ResourceMentionDecoratorProps> | undefined
> {
  __resourceId: string;
  __kind: string;
  __label: string;
  __display: ResourceMentionDisplay;
  __params: Record<string, string> | undefined;

  constructor(info: ResourceMentionInfo, key?: NodeKey) {
    super(key);
    this.__resourceId = info.resourceId;
    this.__kind = info.kind;
    this.__label = info.label;
    this.__display = info.display;
    this.__params = info.params;
  }

  static getType(): string {
    return 'resource-mention';
  }

  static clone(node: ResourceMentionNode): ResourceMentionNode {
    return new ResourceMentionNode(node.getInfo(), node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__resourceId = prevNode.__resourceId;
    this.__kind = prevNode.__kind;
    this.__label = prevNode.__label;
    this.__display = prevNode.__display;
    this.__params = prevNode.__params;
  }

  static importJSON(
    serializedNode: SerializedResourceMentionNode
  ): ResourceMentionNode {
    const node = $createResourceMentionNode({
      resourceId: serializedNode.resourceId,
      kind: serializedNode.kind,
      label: serializedNode.label,
      display: serializedNode.display,
      params: serializedNode.params,
    }).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedResourceMentionNode {
    return {
      ...super.exportJSON(),
      ...this.getInfo(),
      type: 'resource-mention',
      version: 1,
    };
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      a: (domNode: HTMLElement) => {
        const resourceId = domNode.getAttribute('data-resource-id');
        if (!resourceId) return null;
        return {
          conversion: () => ({
            node: $createResourceMentionNode({
              resourceId,
              kind: domNode.getAttribute('data-resource-kind') ?? 'document',
              label: domNode.textContent ?? '',
              display:
                domNode.getAttribute('data-resource-display') === 'card'
                  ? 'card'
                  : 'inline',
            }),
          }),
          priority: 1,
        };
      },
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement(this.isInline() ? 'span' : 'div');
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('a');
    element.setAttribute('href', `resource://${this.__resourceId}`);
    element.setAttribute('data-resource-id', this.__resourceId);
    element.setAttribute('data-resource-kind', this.__kind);
    element.setAttribute('data-resource-display', this.__display);
    element.textContent = this.__label;
    return { element };
  }

  updateDOM(prevNode: this): boolean {
    // A mode change swaps inline for block, so the element must be rebuilt.
    return this.__display !== prevNode.__display;
  }

  getInfo(): ResourceMentionInfo {
    return {
      resourceId: this.__resourceId,
      kind: this.__kind,
      label: this.__label,
      display: this.__display,
      ...(this.__params ? { params: this.__params } : {}),
    };
  }

  getResourceId(): string {
    return this.getLatest().__resourceId;
  }

  getKind(): string {
    return this.getLatest().__kind;
  }

  getLabel(): string {
    return this.getLatest().__label;
  }

  getDisplay(): ResourceMentionDisplay {
    return this.getLatest().__display;
  }

  setDisplay(display: ResourceMentionDisplay): this {
    const writable = this.getWritable();
    writable.__display = display;
    return writable;
  }

  setLabel(label: string): this {
    const writable = this.getWritable();
    writable.__label = label;
    return writable;
  }

  getTextContent(): string {
    return this.__label;
  }

  isInline(): boolean {
    return this.getLatest().__display === 'inline';
  }

  isKeyboardSelectable(): true {
    return true;
  }

  decorate(): DecoratorComponent<ResourceMentionDecoratorProps> | undefined {
    const decorator =
      getDecorator<ResourceMentionDecoratorProps>(ResourceMentionNode);
    if (!decorator) return undefined;
    const props = { ...this.getInfo(), key: this.__key };
    return () => decorator(props);
  }
}

export function $createResourceMentionNode(
  info: ResourceMentionInfo
): ResourceMentionNode {
  return $applyNodeReplacement(new ResourceMentionNode(info));
}

export function $isResourceMentionNode(
  node: LexicalNode | null | undefined
): node is ResourceMentionNode {
  return node instanceof ResourceMentionNode;
}
