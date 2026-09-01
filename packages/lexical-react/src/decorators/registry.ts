/**
 * @file The React seam over the headless decorator registry.
 *
 * The node package is framework-free: its `DecoratorComponent<P>` is
 * `(props: P) => any`, deliberately wide so a backend can import the nodes
 * without pulling in a view library. This module is the one place that narrows
 * that generic to React, so every registration made through it is checked as a
 * real `FC<P>` and every lookup hands back something React can render.
 */
import {
  clearDecorators,
  getDecorator,
  type NodeDecoratorMap,
  setDecorator,
} from '@workspace/lexical-nodes';
import type { FC } from 'react';

/** A decorator component in the React binding: strictly a function component. */
export type ReactDecoratorComponent<P extends object> = FC<P>;

/** Node type names that carry a decorator contract in the node package. */
export type DecoratorNodeName = keyof NodeDecoratorMap;

/** The props a given node's decorator receives. */
export type DecoratorPropsFor<N extends DecoratorNodeName> =
  NodeDecoratorMap[N]['props'];

/** The node class a given node name maps to. */
export type DecoratorKlassFor<N extends DecoratorNodeName> =
  NodeDecoratorMap[N]['klass'];

/**
 * Register a React component as the decorator for a node.
 *
 * Both sides are tied to the same entry of {@link NodeDecoratorMap}, so passing
 * a component whose props do not match the node's decorator contract is a
 * compile error rather than a runtime surprise.
 */
export function setReactDecorator<N extends DecoratorNodeName>(
  name: N,
  klass: DecoratorKlassFor<N>,
  component: ReactDecoratorComponent<DecoratorPropsFor<N>>
): void {
  // `name` is not used at runtime — the registry is keyed by class — but it
  // is what pins `klass` and `component` to the same contract at compile time.
  void name;
  setDecorator(klass, component);
}

/** Look up the React decorator registered for a node, if any. */
export function getReactDecorator<N extends DecoratorNodeName>(
  name: N,
  klass: DecoratorKlassFor<N>
): ReactDecoratorComponent<DecoratorPropsFor<N>> | undefined {
  void name;
  return getDecorator<DecoratorPropsFor<N>>(klass) as
    | ReactDecoratorComponent<DecoratorPropsFor<N>>
    | undefined;
}

/** Drop every registration. Tests use this to keep the registry isolated. */
export function clearReactDecorators(): void {
  clearDecorators();
}
