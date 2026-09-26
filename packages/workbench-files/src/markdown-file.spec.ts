import { describe, expect, it } from 'vitest';
import { documentTitleOf, isMarkdownFile } from './markdown-file.js';

describe('telling a markdown file from an attachment', () => {
  it('recognises the markdown media type', () => {
    expect(isMarkdownFile({ name: 'note', type: 'text/markdown' })).toBe(true);
  });

  it('goes by the extension when the browser reports no useful type', () => {
    expect(isMarkdownFile({ name: 'note.md', type: '' })).toBe(true);
    expect(
      isMarkdownFile({ name: 'README.MARKDOWN', type: 'text/plain' })
    ).toBe(true);
  });

  it('leaves every other file alone', () => {
    expect(isMarkdownFile({ name: 'photo.png', type: 'image/png' })).toBe(
      false
    );
    expect(isMarkdownFile({ name: 'notes.txt', type: 'text/plain' })).toBe(
      false
    );
    expect(isMarkdownFile({ name: 'md', type: '' })).toBe(false);
  });
});

describe('the title a markdown file gives its document', () => {
  it('is the file name without the markdown extension', () => {
    expect(documentTitleOf('note.md')).toBe('note');
    expect(documentTitleOf('Meeting notes.markdown')).toBe('Meeting notes');
  });

  it('keeps dots that belong to the name', () => {
    expect(documentTitleOf('v1.2 plan.md')).toBe('v1.2 plan');
  });

  it('keeps a name that carries no extension', () => {
    expect(documentTitleOf('note')).toBe('note');
  });
});
