/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/*
 * Adapted from facebook/lexical v0.45.0
 * (packages/lexical-react/src/LexicalHorizontalRuleNode.tsx), MIT.
 *
 * Divergences, both forced by this package being headless: the node extends
 * `DecoratorNode` directly rather than re-exporting the React binding, and
 * `decorate()` asks the decorator registry instead of returning JSX. The type
 * string, command, DOM conversion and `$create`/`$is` helpers are upstream's.
 */
import {
  $applyNodeReplacement,
  createCommand,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export type SerializedHorizontalRuleNode = SerializedLexicalNode;

export type HorizontalRuleDecoratorProps = { nodeKey: NodeKey };

export const INSERT_HORIZONTAL_RULE_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_HORIZONTAL_RULE_COMMAND');

function $convertHorizontalRuleElement(): DOMConversionOutput {
  return { node: $createHorizontalRuleNode() };
}

export class HorizontalRuleNode extends DecoratorNode<
  DecoratorComponent<HorizontalRuleDecoratorProps> | undefined
> {
  static getType(): string {
    return 'horizontalrule';
  }

  static clone(node: HorizontalRuleNode): HorizontalRuleNode {
    return new HorizontalRuleNode(node.__key);
  }

  static importJSON(
    serializedNode: SerializedHorizontalRuleNode
  ): HorizontalRuleNode {
    const node = $createHorizontalRuleNode().updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      hr: () => ({
        conversion: $convertHorizontalRuleElement,
        priority: 0,
      }),
    };
  }

  exportJSON(): SerializedHorizontalRuleNode {
    return { ...super.exportJSON(), type: 'horizontalrule', version: 1 };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement('hr');
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('hr') };
  }

  updateDOM(): false {
    return false;
  }

  getTextContent(): string {
    return '\n';
  }

  isInline(): false {
    return false;
  }

  decorate(): DecoratorComponent<HorizontalRuleDecoratorProps> | undefined {
    const decorator = getDecorator<HorizontalRuleDecoratorProps>(
      HorizontalRuleNode
    );
    if (!decorator) return undefined;
    const props = { nodeKey: this.__key };
    return () => decorator(props);
  }
}

export function $createHorizontalRuleNode(): HorizontalRuleNode {
  return $applyNodeReplacement(new HorizontalRuleNode());
}

export function $isHorizontalRuleNode(
  node: LexicalNode | null | undefined
): node is HorizontalRuleNode {
  return node instanceof HorizontalRuleNode;
}
