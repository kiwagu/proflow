/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/*
 * Adapted from facebook/lexical v0.45.0
 * (packages/lexical-playground/src/nodes/EquationNode.tsx), MIT.
 *
 * Divergences, both from this package being headless: `decorate()` goes
 * through the decorator registry instead of returning a React element, and
 * `exportDOM` emits the equation without invoking KaTeX (rendering the TeX is
 * the view layer's business, and importing KaTeX here would put a browser
 * dependency in a package that runs server-side). The base64 `data-lexical-*`
 * attribute contract, type string and helpers are upstream's.
 */
import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export type SerializedEquationNode = Spread<
  {
    equation: string;
    inline: boolean;
  },
  SerializedLexicalNode
>;

export type EquationDecoratorProps = {
  equation: string;
  inline: boolean;
  nodeKey: NodeKey;
};

const encode = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const decode = (value: string): string => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

function $convertEquationElement(
  domNode: HTMLElement
): null | DOMConversionOutput {
  const encoded = domNode.getAttribute('data-lexical-equation');
  const inline = domNode.getAttribute('data-lexical-inline') === 'true';
  const equation = decode(encoded || '');
  if (equation) {
    return { node: $createEquationNode(equation, inline) };
  }
  return null;
}

export class EquationNode extends DecoratorNode<
  DecoratorComponent<EquationDecoratorProps> | undefined
> {
  __equation: string;
  __inline: boolean;

  static getType(): string {
    return 'equation';
  }

  static clone(node: EquationNode): EquationNode {
    return new EquationNode(node.__equation, node.__inline, node.__key);
  }

  constructor(equation: string = '', inline?: boolean, key?: NodeKey) {
    super(key);
    this.__equation = equation;
    this.__inline = inline ?? false;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__equation = prevNode.__equation;
    this.__inline = prevNode.__inline;
  }

  static importJSON(serializedNode: SerializedEquationNode): EquationNode {
    const node = $createEquationNode(
      serializedNode.equation,
      serializedNode.inline
    ).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedEquationNode {
    return {
      ...super.exportJSON(),
      equation: this.getEquation(),
      inline: this.isInline(),
      type: 'equation',
      version: 1,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    element.className = 'editor-equation';
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    element.setAttribute('data-lexical-equation', encode(this.__equation));
    element.setAttribute('data-lexical-inline', `${this.__inline}`);
    element.textContent = this.__equation;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-equation')) return null;
        return { conversion: $convertEquationElement, priority: 2 };
      },
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-equation')) return null;
        return { conversion: $convertEquationElement, priority: 1 };
      },
    };
  }

  updateDOM(prevNode: this): boolean {
    return this.__inline !== prevNode.__inline;
  }

  getTextContent(): string {
    return this.getEquation();
  }

  isInline(): boolean {
    return this.getLatest().__inline;
  }

  getEquation(): string {
    return this.getLatest().__equation;
  }

  setEquation(equation: string): this {
    const writable = this.getWritable();
    writable.__equation = equation;
    return writable;
  }

  decorate(): DecoratorComponent<EquationDecoratorProps> | undefined {
    const decorator = getDecorator<EquationDecoratorProps>(EquationNode);
    if (!decorator) return undefined;
    const props = {
      equation: this.__equation,
      inline: this.__inline,
      nodeKey: this.__key,
    };
    return () => decorator(props);
  }
}

export function $createEquationNode(
  equation = '',
  inline = false
): EquationNode {
  return $applyNodeReplacement(new EquationNode(equation, inline));
}

export function $isEquationNode(
  node: LexicalNode | null | undefined
): node is EquationNode {
  return node instanceof EquationNode;
}
