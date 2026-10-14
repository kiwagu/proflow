/**
 * @file The decorator seam.
 *
 * This package is headless: it defines the document vocabulary and must be
 * importable by a server-side worker, an agent, or a test with no DOM and no
 * view library anywhere in the dependency graph. But some nodes are decorators
 * — their content *is* a rendered component.
 *
 * The two are reconciled by inversion: a node's `decorate()` asks this
 * registry for its renderer and returns `undefined` when nothing is
 * registered. The app registers real components at startup; the headless and
 * server cases simply never do, and the same nodes work in both.
 */
import type { Klass, LexicalNode } from 'lexical';

/**
 * A renderer, kept deliberately wide. Narrowing this to a view library's
 * component type is the *app's* job — doing it here would put that library in
 * this package's types and defeat the point.
 */
export type DecoratorComponent<P> = (props: P) => unknown;

/**
 * Compile-time map from node class to the props its decorator receives.
 * Modules augment this interface so registration and lookup are checked.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NodeDecoratorMap {}

const decorators = new Map<Klass<LexicalNode>, DecoratorComponent<never>>();

export function setDecorator<P>(
  nodeClass: Klass<LexicalNode>,
  component: DecoratorComponent<P>
): void {
  decorators.set(nodeClass, component as DecoratorComponent<never>);
}

export function getDecorator<P>(
  nodeClass: Klass<LexicalNode>
): DecoratorComponent<P> | undefined {
  return decorators.get(nodeClass) as DecoratorComponent<P> | undefined;
}

export function clearDecorators(): void {
  decorators.clear();
}
