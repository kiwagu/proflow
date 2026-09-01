/**
 * Media over the blob store (ADR 0032 §5.4): the dimension rule, the
 * no-empty-hash export rule, and the markdown forms.
 */
import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $createImageNode, $isImageNode } from '../nodes/ImageNode';
import { fitDimensions } from '../nodes/MediaNode';
import { $createVideoNode } from '../nodes/VideoNode';
import {
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '../transformers';

const HASH = 'a'.repeat(64);

function editor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
}

describe('the dimension rule', () => {
  it('preserves aspect ratio when width binds', () => {
    expect(fitDimensions({ width: 800, height: 400 }, { maxWidth: 400 })).toEqual(
      { width: 400, height: 200 }
    );
  });

  it('takes the tighter of two constraints', () => {
    expect(
      fitDimensions(
        { width: 800, height: 400 },
        { maxWidth: 400, maxHeight: 100 }
      )
    ).toEqual({ width: 200, height: 100 });
  });

  it('never enlarges', () => {
    expect(
      fitDimensions({ width: 100, height: 50 }, { maxWidth: 1000 })
    ).toEqual({ width: 100, height: 50 });
  });

  it('treats a missing constraint as no bound', () => {
    expect(fitDimensions({ width: 640, height: 480 })).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('rounds to integers', () => {
    const fitted = fitDimensions({ width: 333, height: 111 }, { maxWidth: 100 });
    expect(Number.isInteger(fitted.width)).toBe(true);
    expect(Number.isInteger(fitted.height)).toBe(true);
  });

  it('leaves non-positive dimensions unscaled', () => {
    expect(fitDimensions({ width: 0, height: 0 }, { maxWidth: 100 })).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe('markdown forms', () => {
  function exportWith(
    build: () => void,
    transformers = INTERNAL_TRANSFORMERS
  ): string {
    const instance = editor();
    instance.update(
      () => {
        $getRoot().clear();
        build();
      },
      { discrete: true }
    );
    let out = '';
    instance.getEditorState().read(() => {
      out = $convertToMarkdownString(transformers);
    });
    return out;
  }

  it('writes the internal image form with its hash', () => {
    const out = exportWith(() => {
      $getRoot().append(
        $createImageNode({
          hash: HASH,
          mime: 'image/png',
          width: 10,
          height: 10,
          alt: 'a picture',
        })
      );
    });
    expect(out).toContain('<x-image>');
    expect(out).toContain(HASH);
  });

  it('writes the external image form as standard markdown', () => {
    const out = exportWith(() => {
      $getRoot().append(
        $createImageNode({
          hash: HASH,
          mime: 'image/png',
          width: 10,
          height: 10,
          alt: 'alt text',
        })
      );
    }, EXTERNAL_TRANSFORMERS);
    expect(out).toContain(`![alt text](blob://${HASH})`);
  });

  it('never exports media whose bytes are still in flight', () => {
    const out = exportWith(() => {
      $getRoot().append(
        $createImageNode({
          hash: '',
          mime: 'image/png',
          width: 10,
          height: 10,
          alt: 'pending',
        })
      );
    });
    expect(out).not.toContain('<x-image>');
    expect(out).not.toContain('blob://');
  });

  it('never exports a video whose bytes are still in flight', () => {
    const out = exportWith(() => {
      $getRoot().append(
        $createVideoNode({
          hash: '',
          mime: 'video/mp4',
          width: 0,
          height: 0,
          controls: true,
        })
      );
    });
    expect(out).not.toContain('<x-video>');
  });

  it('round-trips an image through the internal form', () => {
    const source = `<x-image>{"hash":"${HASH}","mime":"image/png","width":640,"height":480,"alt":"cat"}</x-image>`;
    const instance = editor();
    instance.update(
      () => {
        $getRoot().clear();
        $convertFromMarkdownString(source, INTERNAL_TRANSFORMERS);
      },
      { discrete: true }
    );

    const found = instance.getEditorState().read(() => {
      const collected: Array<{ hash: string; alt: string }> = [];
      const visit = (node: ReturnType<typeof $getRoot>) => {
        for (const child of node.getChildren()) {
          if ($isImageNode(child)) {
            collected.push({ hash: child.getHash(), alt: child.getAlt() });
          }
          const asElement = child as unknown as ReturnType<typeof $getRoot>;
          if (typeof asElement.getChildren === 'function') visit(asElement);
        }
      };
      visit($getRoot());
      return collected;
    });

    expect(found).toEqual([{ hash: HASH, alt: 'cat' }]);
  });

  it('accepts a plain http image and leaves the hash for ingest to fill', () => {
    const instance = editor();
    instance.update(
      () => {
        $getRoot().clear();
        $convertFromMarkdownString(
          '![remote](https://example.com/a.png)',
          INTERNAL_TRANSFORMERS
        );
      },
      { discrete: true }
    );

    const hashes = instance.getEditorState().read(() => {
      const collected: string[] = [];
      const visit = (node: ReturnType<typeof $getRoot>) => {
        for (const child of node.getChildren()) {
          if ($isImageNode(child)) collected.push(child.getHash());
          const asElement = child as unknown as ReturnType<typeof $getRoot>;
          if (typeof asElement.getChildren === 'function') visit(asElement);
        }
      };
      visit($getRoot());
      return collected;
    });

    expect(hashes).toEqual(['']);
  });
});
