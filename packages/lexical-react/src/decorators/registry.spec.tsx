import {
  getDecorator,
  HorizontalRuleNode,
  ImageNode,
} from '@workspace/lexical-nodes';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearReactDecorators,
  type DecoratorPropsFor,
  getReactDecorator,
  type ReactDecoratorComponent,
  setReactDecorator,
} from './registry';

afterEach(() => {
  clearReactDecorators();
});

// The narrowing is what this module exists for, so it is asserted at the type
// level too: the component below is declared as a React FC over the node's own
// decorator props, and only compiles if the binding really ties the two
// together. A mismatch here is a build failure, not a runtime one.
const Rule: ReactDecoratorComponent<DecoratorPropsFor<'HorizontalRuleNode'>> = (
  props
) => {
  // `key` comes from the node contract, proving the props type flowed through.
  return props.key ? null : null;
};

describe('react decorator registry', () => {
  it('round-trips a registered component through the headless registry', () => {
    setReactDecorator('HorizontalRuleNode', HorizontalRuleNode, Rule);

    expect(getReactDecorator('HorizontalRuleNode', HorizontalRuleNode)).toBe(
      Rule
    );
    // Registration goes through the shared registry, so the headless getter
    // sees it too — the binding narrows the type, it does not fork storage.
    expect(getDecorator(HorizontalRuleNode)).toBe(Rule);
  });

  it('returns undefined for a node with no decorator registered', () => {
    expect(getReactDecorator('ImageNode', ImageNode)).toBeUndefined();
  });

  it('clears registrations', () => {
    setReactDecorator('HorizontalRuleNode', HorizontalRuleNode, Rule);
    expect(getReactDecorator('HorizontalRuleNode', HorizontalRuleNode)).toBe(
      Rule
    );

    clearReactDecorators();

    expect(
      getReactDecorator('HorizontalRuleNode', HorizontalRuleNode)
    ).toBeUndefined();
  });

  it('keeps registrations per node class', () => {
    const Image: ReactDecoratorComponent<DecoratorPropsFor<'ImageNode'>> = () =>
      null;

    setReactDecorator('HorizontalRuleNode', HorizontalRuleNode, Rule);
    setReactDecorator('ImageNode', ImageNode, Image);

    expect(getReactDecorator('HorizontalRuleNode', HorizontalRuleNode)).toBe(
      Rule
    );
    expect(getReactDecorator('ImageNode', ImageNode)).toBe(Image);
  });
});
