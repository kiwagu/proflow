import { describe, expect, it } from 'vitest';
import {
  documentTitleOf,
  isMarkdownFile,
  MarkdownEncodingError,
  readMarkdownText,
} from './markdown-file.js';

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

describe('reading the text of a markdown file', () => {
  it('decodes UTF-8, including text outside ASCII', async () => {
    const file = new File([new TextEncoder().encode('# Привет\n')], 'note.md');
    await expect(readMarkdownText(file)).resolves.toBe('# Привет\n');
  });

  it('accepts an empty file as an empty document', async () => {
    await expect(readMarkdownText(new File([], 'note.md'))).resolves.toBe('');
  });

  it('refuses bytes that are not UTF-8 instead of silently mangling them', async () => {
    // "Привет" in Windows-1251: every byte is an invalid UTF-8 sequence, and
    // a lenient decoder would turn the file into replacement characters.
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    await expect(
      readMarkdownText(new File([cp1251], 'note.md'))
    ).rejects.toBeInstanceOf(MarkdownEncodingError);
  });
});
