/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/*
 * Copied from facebook/lexical v0.45.0
 * (packages/lexical-react/src/LexicalDecoratorBlockNode.ts), MIT.
 *
 * One deliberate divergence: this package is headless, so the decorator type
 * is the registry's framework-free component type instead of `JSX.Element`.
 * The class is otherwise the upstream text.
 */
import {
  DecoratorNode,
  type ElementFormatType,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';

export type SerializedDecoratorBlockNode = Spread<
  {
    format: ElementFormatType;
  },
  SerializedLexicalNode
>;

export class DecoratorBlockNode<T = unknown> extends DecoratorNode<T> {
  __format: ElementFormatType;

  constructor(format?: ElementFormatType, key?: NodeKey) {
    super(key);
    this.__format = format || '';
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__format = prevNode.__format;
  }

  exportJSON(): SerializedDecoratorBlockNode {
    return {
      ...super.exportJSON(),
      format: this.__format || '',
    };
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedDecoratorBlockNode>
  ): this {
    return super
      .updateFromJSON(serializedNode)
      .setFormat(serializedNode.format || '');
  }

  canIndent(): false {
    return false;
  }

  createDOM(): HTMLElement {
    return document.createElement('div');
  }

  updateDOM(): false {
    return false;
  }

  setFormat(format: ElementFormatType): this {
    const self = this.getWritable();
    self.__format = format;
    return self;
  }

  getFormat(): ElementFormatType {
    return this.getLatest().__format;
  }

  isInline(): false {
    return false;
  }
}

export function $isDecoratorBlockNode(
  node: LexicalNode | null | undefined
): node is DecoratorBlockNode<unknown> {
  return node instanceof DecoratorBlockNode;
}
