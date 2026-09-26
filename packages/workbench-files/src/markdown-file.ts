/**
 * @file Which dropped files are documents rather than attachments, and how
 * their text is read.
 *
 * A markdown file is what a document IS outside this product, so storing one
 * as an opaque attachment would hide its content from the editor. The
 * decision reads the name as well as the type: browsers report `.md` with no
 * type at all, or as plain text, depending on the platform.
 */
const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

export function isMarkdownFile(file: { name: string; type: string }): boolean {
  return file.type === 'text/markdown' || MARKDOWN_EXTENSION.test(file.name);
}

/** The title a markdown file gives the document made from it; empty for a bare extension. */
export function documentTitleOf(name: string): string {
  return name.replace(MARKDOWN_EXTENSION, '');
}

/** The file's bytes are not UTF-8 text, so it cannot become a document faithfully. */
export class MarkdownEncodingError extends Error {
  constructor() {
    super('the file is not UTF-8 text');
    this.name = 'MarkdownEncodingError';
  }
}

/**
 * The text of a markdown file, decoded strictly.
 *
 * `File.text()` decodes leniently: every invalid sequence becomes a
 * replacement character and the promise still resolves, so a file in a
 * legacy code page would silently become a document of garbage while its
 * real bytes were never stored anywhere. Refusing is the honest outcome.
 */
export async function readMarkdownText(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new MarkdownEncodingError();
  }
}
