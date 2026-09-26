/**
 * @file Which dropped files are documents rather than attachments.
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

/** The title a markdown file gives the document made from it. */
export function documentTitleOf(name: string): string {
  return name.replace(MARKDOWN_EXTENSION, '');
}
