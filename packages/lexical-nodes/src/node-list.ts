/**
 * @file What each editor is allowed to contain.
 *
 * Lexical fixes an editor's node set at construction: a node class that was
 * not passed to `createEditor` cannot appear in that editor at all, and
 * importing content that references it throws. So this map is the only place
 * an editor's capabilities are declared, and adding a node to the vocabulary
 * means adding it here or it is unreachable.
 */
import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { MarkNode } from '@lexical/mark';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  type Klass,
  type LexicalNode,
  LineBreakNode,
  ParagraphNode,
  TabNode,
  TextNode,
} from 'lexical';
import { EquationNode } from './nodes/EquationNode';
import { FileNode } from './nodes/FileNode';
import { HorizontalRuleNode } from './nodes/HorizontalRuleNode';
import { ImageNode } from './nodes/ImageNode';
import { ResourceMentionNode } from './nodes/ResourceMentionNode';
import { UnknownEmbedNode } from './nodes/UnknownEmbedNode';
import { VideoNode } from './nodes/VideoNode';

/** Lexical's own nodes, always present. */
const CORE_NODES = [
  ParagraphNode,
  TextNode,
  LineBreakNode,
  TabNode,
] as const satisfies ReadonlyArray<Klass<LexicalNode>>;

/** Rich-text structure from the official packages. */
const RICH_TEXT_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  MarkNode,
  CodeNode,
  CodeHighlightNode,
  TableNode,
  TableRowNode,
  TableCellNode,
] as const satisfies ReadonlyArray<Klass<LexicalNode>>;

/** This vocabulary's own nodes. */
const OWN_NODES = [
  HorizontalRuleNode,
  EquationNode,
  ResourceMentionNode,
  ImageNode,
  VideoNode,
  FileNode,
  UnknownEmbedNode,
] as const satisfies ReadonlyArray<Klass<LexicalNode>>;

/** Every node class this package defines or adopts. */
export const SupportedNodeTypes: ReadonlyArray<Klass<LexicalNode>> = [
  ...CORE_NODES,
  ...RICH_TEXT_NODES,
  ...OWN_NODES,
];

/**
 * The editors the product builds.
 *
 * `markdown-sync` is deliberately absent: whether a document syncs is a
 * provider concern, not a node-set one, and having had it as an editor type
 * meant the same document had two node sets depending on how it was opened.
 */
export type EditorType = 'plain-text' | 'markdown' | 'chat' | 'title';

const PLAIN_TEXT_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  ParagraphNode,
  TextNode,
];

/** Chat is markdown minus the things you cannot put in a chat message. */
const CHAT_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  ...CORE_NODES,
  ...RICH_TEXT_NODES,
  HorizontalRuleNode,
  EquationNode,
  ResourceMentionNode,
  UnknownEmbedNode,
];

export const RegisteredNodesByType: Record<
  EditorType,
  ReadonlyArray<Klass<LexicalNode>>
> = {
  'plain-text': PLAIN_TEXT_NODES,
  markdown: SupportedNodeTypes,
  chat: CHAT_NODES,
  title: PLAIN_TEXT_NODES,
};
