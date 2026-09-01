/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/*
 * The inline `$...$` rule is the `EQUATION` transformer from
 * facebook/lexical v0.45.0
 * (packages/lexical-playground/src/plugins/MarkdownTransformers/index.ts),
 * MIT. The block `$$...$$` rule is this vocabulary's own addition, written to
 * the same shape.
 */
import type {
  ElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import { $createParagraphNode, type LexicalNode } from 'lexical';
import {
  $createEquationNode,
  $isEquationNode,
  EquationNode,
} from '../nodes/EquationNode';

/**
 * Block equations, `$$...$$` on their own line.
 *
 * Registered BEFORE the inline rule: `$$x$$` matches the inline pattern too,
 * and whichever runs first wins, so the more specific form has to lead.
 */
export const EQUATION_BLOCK: ElementTransformer = {
  dependencies: [EquationNode],
  type: 'element',
  regExp: /^\$\$(.+?)\$\$$/,
  export: (node: LexicalNode) => {
    if (!$isEquationNode(node)) return null;
    if (node.isInline()) return null;
    return `$$${node.getEquation()}$$`;
  },
  replace: (parentNode, _children, match) => {
    const paragraph = $createParagraphNode();
    paragraph.append($createEquationNode(match[1] ?? '', false));
    parentNode.replace(paragraph);
  },
};

/** Inline equations, `$...$` mid-sentence. */
export const EQUATION_INLINE: TextMatchTransformer = {
  dependencies: [EquationNode],
  type: 'text-match',
  importRegExp: /\$([^$]+?)\$/,
  regExp: /\$([^$]+?)\$$/,
  export: (node: LexicalNode) => {
    if (!$isEquationNode(node)) return null;
    if (!node.isInline()) return null;
    return `$${node.getEquation()}$`;
  },
  replace: (textNode, match) => {
    const [, equation] = match;
    textNode.replace($createEquationNode(equation ?? '', true));
  },
  trigger: '$',
};
