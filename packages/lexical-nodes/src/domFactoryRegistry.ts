/**
 * @file The `createDOM` seam.
 *
 * The sibling of `decoratorRegistry`, for the other half of the problem: a few
 * nodes render as plain DOM the app wants to own (classes, data attributes,
 * wrappers) without the node itself knowing anything about the app's markup.
 *
 * A node whose DOM is app-owned asks here first and falls back to its own
 * default when nothing is registered, which is what keeps it renderable in a
 * headless build.
 */
import type { EditorConfig, Klass, LexicalNode } from 'lexical';

export type DomFactory<N extends LexicalNode = LexicalNode> = (
  node: N,
  config: EditorConfig
) => HTMLElement;

const factories = new Map<Klass<LexicalNode>, DomFactory>();

export function setDomFactory<N extends LexicalNode>(
  nodeClass: Klass<N>,
  factory: DomFactory<N>
): void {
  factories.set(nodeClass as Klass<LexicalNode>, factory as DomFactory);
}

export function getDomFactory<N extends LexicalNode>(
  nodeClass: Klass<N>
): DomFactory<N> | undefined {
  return factories.get(nodeClass as Klass<LexicalNode>) as
    | DomFactory<N>
    | undefined;
}

export function clearDomFactories(): void {
  factories.clear();
}
