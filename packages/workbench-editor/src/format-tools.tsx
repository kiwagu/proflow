'use client';

import {
  defaultSelectionData,
  NODE_TRANSFORM,
  type NodeTransformType,
  type SelectionData,
  UNLINK_COMMAND,
  UPDATE_LINK_COMMAND,
  useEditorEditable,
  useLexicalWrapper,
  useStore,
} from '@workspace/lexical-react';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { Input } from '@workspace/ui/components/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Separator } from '@workspace/ui/components/separator';
import { cn } from '@workspace/ui/lib/utils';
import {
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type TextFormatType,
} from 'lexical';
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link as LinkIcon,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useReducer, useState, type ReactNode } from 'react';
import {
  BLOCK_OPTIONS,
  defaultFormatToolsLabels,
  type BlockOption,
  type FormatToolsLabels,
} from './labels.js';

export type FormatToolsProps = {
  labels?: FormatToolsLabels;
  className?: string;
  /** Extra controls rendered at the toolbar's end (e.g. a TableInsert). */
  children?: ReactNode;
};

/** One inline text-format toggle, active state driven by the selection. */
function FormatToggle({
  icon: Icon,
  label,
  format,
  active,
  onFormat,
}: {
  icon: LucideIcon;
  label: string;
  format: TextFormatType;
  active: boolean;
  onFormat: (format: TextFormatType) => void;
}) {
  return (
    <Hint label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={active}
        className={cn(active && 'bg-accent text-foreground')}
        // Pointer-down instead of click so the editor selection is not lost
        // to the button's own focus before the command reads it.
        onPointerDown={(e) => {
          e.preventDefault();
          onFormat(format);
        }}
      >
        <Icon aria-hidden />
      </Button>
    </Hint>
  );
}

/**
 * Which single block option the selection sits in, or '' when it spans
 * several block types (a Select can honestly show only one value).
 */
function blockValueOf(selection: SelectionData): BlockOption | '' {
  if (selection.elementsInRange.size !== 1) return '';
  const [only] = selection.elementsInRange;
  return (BLOCK_OPTIONS as readonly string[]).includes(only as string)
    ? (only as BlockOption)
    : '';
}

/**
 * The document format toolbar: undo/redo, block-type select, inline format
 * toggles, and a link popover. Reads the live selection from the wrapper's
 * selection store and dispatches editor commands — it holds no document
 * state of its own. Must render inside a DocumentView (wrapper context).
 */
export function FormatTools({
  labels = defaultFormatToolsLabels,
  className,
  children,
}: FormatToolsProps) {
  const wrapper = useLexicalWrapper();
  // The selection store is attached by the selection plugin in the mount's
  // effect, which runs AFTER this child first rendered — so the first render
  // sees no store. The one-shot re-render below re-subscribes to the real
  // store once it exists (the subscribe identity changes with it).
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!wrapper.selection) bump();
  }, [wrapper]);
  const selection = useStore(wrapper.selection ?? emptySelectionStore);
  const editor = wrapper.editor;
  // Live: the tools grey out the moment the editor stops taking input.
  const editable = useEditorEditable(wrapper.editor);
  const disabled = !editable || !wrapper.isInteractable();

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const dispatchFormat = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const blockValue = blockValueOf(selection);

  return (
    <div
      role="toolbar"
      aria-label={labels.toolbar}
      className={cn(
        'bg-background flex items-center gap-1 border-b p-1',
        className
      )}
    >
      <Hint label={labels.undo}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.undo}
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault();
            editor.dispatchCommand(UNDO_COMMAND, undefined);
          }}
        >
          <Undo2 aria-hidden />
        </Button>
      </Hint>
      <Hint label={labels.redo}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.redo}
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault();
            editor.dispatchCommand(REDO_COMMAND, undefined);
          }}
        >
          <Redo2 aria-hidden />
        </Button>
      </Hint>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Select
        value={blockValue}
        disabled={disabled}
        onValueChange={(next) => {
          editor.dispatchCommand(NODE_TRANSFORM, next as NodeTransformType);
          editor.focus();
        }}
      >
        <SelectTrigger size="sm" className="w-36" aria-label={labels.blockType}>
          <SelectValue placeholder={labels.blockType} />
        </SelectTrigger>
        <SelectContent>
          {BLOCK_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {labels.blocks[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <FormatToggle
        icon={Bold}
        label={labels.bold}
        format="bold"
        active={selection.bold}
        onFormat={dispatchFormat}
      />
      <FormatToggle
        icon={Italic}
        label={labels.italic}
        format="italic"
        active={selection.italic}
        onFormat={dispatchFormat}
      />
      <FormatToggle
        icon={Underline}
        label={labels.underline}
        format="underline"
        active={selection.underline}
        onFormat={dispatchFormat}
      />
      <FormatToggle
        icon={Strikethrough}
        label={labels.strikethrough}
        format="strikethrough"
        active={selection.strikethrough}
        onFormat={dispatchFormat}
      />
      <FormatToggle
        icon={Code}
        label={labels.code}
        format="code"
        active={selection.code}
        onFormat={dispatchFormat}
      />
      <FormatToggle
        icon={Highlighter}
        label={labels.highlight}
        format="highlight"
        active={selection.highlight}
        onFormat={dispatchFormat}
      />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Popover open={linkOpen} onOpenChange={setLinkOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.link}
            aria-pressed={selection.hasLinks}
            disabled={disabled}
            className={cn(selection.hasLinks && 'bg-accent text-foreground')}
          >
            <LinkIcon aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const url = linkUrl.trim();
              if (!url) return;
              editor.dispatchCommand(UPDATE_LINK_COMMAND, {
                url,
                linkText: url,
              });
              setLinkUrl('');
              setLinkOpen(false);
              editor.focus();
            }}
          >
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder={labels.linkUrlPlaceholder}
              aria-label={labels.link}
              autoFocus
            />
            <Button type="submit" size="sm" variant="secondary">
              {labels.linkApply}
            </Button>
          </form>
          {selection.hasLinks ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive mt-2 w-full"
              onClick={() => {
                editor.dispatchCommand(UNLINK_COMMAND, undefined);
                setLinkOpen(false);
                editor.focus();
              }}
            >
              {labels.linkRemove}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>

      {children}
    </div>
  );
}

/**
 * A frozen empty store for the window between mount and the selection
 * plugin's registration — subscribers see the default selection and are
 * re-rendered by the real store once the wrapper carries it.
 */
const emptySelectionStore = {
  get: () => defaultSelectionData,
  subscribe: () => () => {},
};
