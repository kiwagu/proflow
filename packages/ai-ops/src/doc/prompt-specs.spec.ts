import { describe, expect, it } from 'vitest';
import { setup } from '../ai-toolkit/_test-helpers';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';
import type { NodeSpec } from '../editor/ops';

const BLOCK_SPECS: NodeSpec[] = [
  { block: 'paragraph', text: 'p' },
  { block: 'heading', level: 2, text: 'h' },
  { block: 'quote', text: 'q' },
  { block: 'code', language: 'ts', text: 'const x = 1' },
  { block: 'list', list: 'check', items: ['a', 'b'] },
  { block: 'table', rows: [['Item', 'Done']] },
  { block: 'divider' },
  { block: 'image', hash: 'aaa', mime: 'image/png', alt: 'cat' },
  { block: 'video', hash: 'bbb', mime: 'video/mp4', controls: true },
  { block: 'equation', tex: 'x^2' },
];

const INLINE_SPECS: NodeSpec[] = [
  { inline: 'linebreak' },
  { inline: 'equation', tex: 'x^2' },
  {
    inline: 'mention',
    mention: { resourceId: 'd1', kind: 'document', label: 'Roadmap' },
  },
];

describe('the specs the agent prompt documents are the specs buildNode accepts', () => {
  it.each(BLOCK_SPECS)('builds block spec %j', (spec) => {
    const { session, ids } = setup('anchor');
    new Doc(session).apply({
      kind: 'insertNode',
      ref: 'r',
      spec,
      at: { after: ids[0]! },
    });
    expect(serializeWithXml(session)).toContain('id="r"');
  });

  it.each(INLINE_SPECS)('builds inline spec %j', (spec) => {
    const { session, ids } = setup('anchor');
    new Doc(session).apply({
      kind: 'insertInline',
      ref: 'r',
      node: ids[0]!,
      at: 0,
      spec,
    });
    expect(serializeWithXml(session)).toContain('id="r"');
  });

  // The prompt used to document these; both are gone from the vocabulary.
  // If either ever silently builds again, the prompt could drift back.
  it.each([
    { block: 'document-card', documentId: 'd1' },
    { block: 'html-render', html: '<b>x</b>' },
    { block: 'image', srcType: 'url', url: 'https://x/cat.png' },
  ])('rejects the dropped spec %j', (spec) => {
    const { session, ids } = setup('anchor');
    const insert = () =>
      new Doc(session).apply({
        kind: 'insertNode',
        ref: 'r',
        // deliberately off-contract: this is what a stale prompt would emit
        spec: spec as unknown as NodeSpec,
        at: { after: ids[0]! },
      });
    expect(insert).toThrow();
  });
});
