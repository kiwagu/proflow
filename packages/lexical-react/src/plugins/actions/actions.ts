import { LinkNode } from '@lexical/link';
import { ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { INSERT_TABLE_COMMAND, TableNode } from '@lexical/table';
import {
  CustomCodeNode,
  EquationNode,
  FileNode,
  HorizontalRuleNode,
  ImageNode,
} from '@workspace/lexical-nodes';
import {
  CodeIcon as CodeBlock,
  ImageIcon,
  LinkIcon,
  ListIcon as ListBullets,
  ListChecksIcon as ListChecks,
  ListOrderedIcon as ListNumbers,
  MinusIcon as Minus,
  PaperclipIcon as Paperclip,
  QuoteIcon as Quote,
  SigmaIcon as MathIcon,
  Table2Icon as TableIcon,
  Heading1Icon as TextH1,
  Heading3Icon as TextH3,
  Heading2Icon as TextH2,
  TypeIcon as TextT,
} from 'lucide-react';
import type { LexicalEditor } from 'lexical';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '..';
import { TRY_INSERT_EQUATION_COMMAND } from '../katex';
import { TRY_INSERT_LINK_COMMAND } from '../links';
import { TRY_INSERT_ATTACHMENT_UPLOAD_COMMAND } from '../media';
import { NODE_TRANSFORM } from '../node-transform';
import { TRY_INSERT_TABLE_PICKER_COMMAND } from '../tables';
import { type Action, ActionCategory } from './types';

export const ACTIONS: Action[] = [
  {
    id: 'paragraph',
    name: 'Normal Text',
    keywords: ['paragraph', 'text', 'none', 'normal'],
    category: ActionCategory.ELEMENT,
    icon: TextT,
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'paragraph');
    },
  },
  {
    id: 'heading1',
    name: 'Heading 1',
    keywords: ['h1', 'title', 'large', 'header'],
    category: ActionCategory.FORMAT,
    icon: TextH1,
    shortcut: '#',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'heading1');
    },
    dependencies: [HeadingNode],
  },
  {
    id: 'heading2',
    name: 'Heading 2',
    keywords: ['h2', 'title', 'medium', 'header'],
    category: ActionCategory.FORMAT,
    icon: TextH2,
    shortcut: '##',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'heading2');
    },
    dependencies: [HeadingNode],
  },
  {
    id: 'heading3',
    name: 'Heading 3',
    keywords: ['h3', 'title', 'medium', 'header'],
    category: ActionCategory.FORMAT,
    icon: TextH3,
    shortcut: '###',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'heading3');
    },
    dependencies: [HeadingNode],
  },
  {
    id: 'quote',
    name: 'Quote',
    keywords: ['quote'],
    category: ActionCategory.ELEMENT,
    icon: Quote,
    shortcut: '>',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'quote');
    },
    dependencies: [QuoteNode],
  },
  {
    id: 'code',
    name: 'Code',
    keywords: ['code', 'pre', 'programming'],
    category: ActionCategory.ELEMENT,
    icon: CodeBlock,
    shortcut: '```',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'code');
    },
    dependencies: [CustomCodeNode],
  },
  {
    id: 'list-bullet',
    name: 'Bullet List',
    keywords: ['bullet', 'list', 'unordered'],
    category: ActionCategory.ELEMENT,
    icon: ListBullets,
    shortcut: '-',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'list-bullet');
    },
    dependencies: [ListNode],
  },
  {
    id: 'list-number',
    name: 'Numbered List',
    keywords: ['numbered', 'list', 'ordered'],
    category: ActionCategory.ELEMENT,
    icon: ListNumbers,
    shortcut: '1.',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'list-number');
    },
    dependencies: [ListNode],
  },
  {
    id: 'list-check',
    name: 'Checklist',
    keywords: ['checklist', 'list', 'checked'],
    category: ActionCategory.ELEMENT,
    icon: ListChecks,
    shortcut: '[]',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'list-check');
    },
    dependencies: [ListNode],
  },
  {
    id: 'link',
    name: 'Link',
    keywords: ['link', 'url'],
    icon: LinkIcon,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        editor.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);
      });
    },
    dependencies: [LinkNode],
  },
  {
    id: 'latex',
    name: 'Math',
    keywords: ['math', 'latex', 'equation'],
    icon: MathIcon,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        editor.dispatchCommand(TRY_INSERT_EQUATION_COMMAND, undefined);
      });
    },
    dependencies: [EquationNode],
  },
  {
    id: 'table',
    name: 'Table',
    keywords: ['table', 'grid'],
    icon: TableIcon,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        const pickerOpened = editor.dispatchCommand(
          TRY_INSERT_TABLE_PICKER_COMMAND,
          undefined
        );
        if (!pickerOpened) {
          editor.dispatchCommand(INSERT_TABLE_COMMAND, {
            columns: '3',
            rows: '3',
            includeHeaders: false,
          });
        }
      });
    },
    dependencies: [TableNode],
  },
  {
    id: 'hr',
    name: 'Divider',
    keywords: ['hr', 'horizontal', 'line', 'divider'],
    icon: Minus,
    shortcut: '---',
    category: ActionCategory.ELEMENT,
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
    },
    dependencies: [HorizontalRuleNode],
  },
  {
    id: 'image',
    name: 'Image',
    keywords: ['image', 'picture', 'photo', 'media', 'upload'],
    icon: ImageIcon,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() =>
        editor.dispatchCommand(TRY_INSERT_ATTACHMENT_UPLOAD_COMMAND, 'image')
      );
    },
    dependencies: [ImageNode],
  },
  {
    id: 'file',
    name: 'File',
    keywords: ['file', 'attachment', 'attach', 'upload', 'pdf', 'video'],
    icon: Paperclip,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() =>
        editor.dispatchCommand(TRY_INSERT_ATTACHMENT_UPLOAD_COMMAND, 'all')
      );
    },
    dependencies: [FileNode],
  },
];
