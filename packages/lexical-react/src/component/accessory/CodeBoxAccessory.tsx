/**
 * @file The accessory rendered for code nodes — a copy button and a syntax
 * highlighting language selector.
 */
import {
  $isCodeNode,
  CODE_LANGUAGE_FRIENDLY_NAME_MAP,
  CodeNode,
  getLanguageFriendlyName,
  normalizeCodeLanguage,
} from '@lexical/code';
import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { cn } from '@workspace/ui/lib/utils';
import {
  $getNodeByKey,
  type EditorThemeClasses,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import {
  BracesIcon,
  CopyIcon,
  FileCode2Icon,
  FileCodeIcon,
  FileJson2Icon,
  FileTextIcon,
  FileTypeIcon,
  Trash2Icon,
} from 'lucide-react';
import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGlueToElement } from '../../directive/glueToElement';
import { deleteCodeNode } from '../../plugins/code/deleteCodeNode';
import { useAutoRegister } from '../../plugins/shared/utils';
import { useIsInBlock, useIsNestedBlock } from '../../support/block';
import { ENABLE_SVG_PREVIEW } from '../../support/featureFlags';
import { EXTRA_PICKER_LANGUAGES } from '../../plugins/code/prismLanguages';
import {
  type CodeBoxAccessoryLabels,
  defaultCodeBoxAccessoryLabels,
} from './codeBoxAccessoryLabels';

type IconComponent = FC<{ className?: string }>;

/**
 * The picker offers the official code package's language registry, plus the
 * languages the product has always offered that the highlighter does not carry
 * itself — those come from the module that also registers their grammars, so
 * offering one and highlighting it cannot drift apart. A language the
 * highlighter gains shows up here with the fallback icon and no edit to this
 * file.
 */
const PICKER_LANGUAGES: ReadonlyArray<[key: string, label: string]> = [
  ...Object.entries(CODE_LANGUAGE_FRIENDLY_NAME_MAP),
  ...EXTRA_PICKER_LANGUAGES,
];

const EXTRA_LANGUAGE_NAMES = new Map(EXTRA_PICKER_LANGUAGES);

/**
 * The display name for a language. `getLanguageFriendlyName` only knows the
 * highlighter's own registry and echoes the raw key for anything else, which
 * would label a language the picker offered as "JSON" with a lowercase `json`
 * everywhere outside the menu row.
 */
function languageFriendlyName(language: string): string {
  return (
    EXTRA_LANGUAGE_NAMES.get(language) ?? getLanguageFriendlyName(language)
  );
}

const FallbackIcon: IconComponent = FileTextIcon;

const LanguageIcons: Record<string, IconComponent> = {
  plain: FileTextIcon,
  js: FileCodeIcon,
  typescript: FileTypeIcon,
  py: FileCode2Icon,
  rust: FileCode2Icon,
  java: FileCodeIcon,
  swift: FileCodeIcon,
  c: FileCodeIcon,
  cpp: FileCodeIcon,
  css: FileCodeIcon,
  html: FileCodeIcon,
  markdown: FileTextIcon,
  powershell: FileCodeIcon,
  sql: FileJson2Icon,
  xml: FileCodeIcon,
  json: BracesIcon,
  bash: FileCodeIcon,
  svg: FileCodeIcon,
};

/** The highlighter's canonical key for a language, `plain` when unset. */
function canonicalLanguage(language: string | null | undefined): string {
  return normalizeCodeLanguage((language ?? 'plain').toLowerCase());
}

/** The icon for a language, resolved as a component so lookups stay stable. */
function LanguageIcon({
  language,
  className,
}: {
  language: string;
  className?: string;
}) {
  const Icon = LanguageIcons[language] ?? FallbackIcon;
  return <Icon className={className} />;
}

function StaticLabel({ language }: { language: string }) {
  return (
    <div className="text-muted-foreground/50 flex items-center gap-1 p-2 font-sans text-xs font-medium">
      <LanguageIcon language={language} className="size-4" />
      <span className="select-none">{languageFriendlyName(language)}</span>
    </div>
  );
}

function CodeLanguageSelector({
  language,
  setLanguage,
  editor,
}: {
  language: string | null;
  setLanguage: (language: string) => void;
  editor?: LexicalEditor;
}) {
  const [open, setOpen] = useState(false);
  const editable = Boolean(editor && editor.isEditable());
  const current = canonicalLanguage(language);

  if (!editable) return <StaticLabel language={current} />;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground/50 p-1.5"
          tabIndex={-1}
        >
          <LanguageIcon language={current} className="size-4" />
          <span>{languageFriendlyName(current)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          {PICKER_LANGUAGES.map(([key, label]) => (
            <DropdownMenuItem
              key={key}
              onSelect={() => {
                setLanguage(key);
              }}
            >
              <LanguageIcon language={key} className="size-4 shrink-0" />
              <span className="flex-1 truncate">{label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The origin uses a design-system switch here; this package has no switch
 * primitive, so the preview toggle is a native checkbox styled to the same
 * track/thumb geometry. Same affordance, same size, no new dependency.
 */
function PreviewToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span className="bg-border hover:ring-border peer-focus-visible:ring-ring peer-checked:bg-primary inline-flex h-4 w-8 shrink-0 items-center rounded-full border-2 border-transparent transition-colors peer-focus-visible:ring-2 hover:ring">
        <span className="bg-background block size-3 rounded-full transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function copyToClipboard(code: string) {
  if (!code) return;
  try {
    void navigator.clipboard.writeText(code);
  } catch (e) {
    console.error('Failed to copy code to clipboard', e);
  }
}

export function CodeBoxAccessory({
  floatRef,
  editor,
  nodeKey,
  labels = defaultCodeBoxAccessoryLabels,
}: {
  floatRef: HTMLElement;
  editor: LexicalEditor;
  nodeKey: NodeKey;
  labels?: CodeBoxAccessoryLabels;
}) {
  const [language, setLanguage] = useState('JavaScript');
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Both hooks run unconditionally; the origin's short-circuit would make the
  // second one conditional, which React forbids.
  const inBlock = useIsInBlock();
  const nestedBlock = useIsNestedBlock();
  const isNested = inBlock && nestedBlock;
  const glueRef = useGlueToElement(editor, isNested ? null : floatRef);

  // The language selector tracks the node whatever set it (the picker, a
  // markdown fence, an agent edit), so the listener is always on; the
  // preview toggle below is component state — the stock code node persists
  // no preview flag, and the toggle is a viewing aid, not document content.
  useAutoRegister(editor, (editorInstance) =>
    editorInstance.registerMutationListener(
      CodeNode,
      (mutations) => {
        const match = mutations.get(nodeKey);
        if (match === 'created' || match === 'updated') {
          queueMicrotask(() =>
            editorInstance.read(() => {
              const node = $getNodeByKey(nodeKey);
              if (!$isCodeNode(node)) return;
              setLanguage(node.getLanguage() ?? 'plain');
            })
          );
        }
      },
      { skipInitialization: false }
    )
  );

  const readCode = useCallback(
    () =>
      editor.read(() => {
        const node = $getNodeByKey(nodeKey);
        if (!node) return '';
        return node.getTextContent();
      }),
    [editor, nodeKey]
  );

  const setLanguageOnNode = (next: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isCodeNode(node)) return;
      node.setLanguage(next);
    });
  };

  const showPreviewToggle =
    ENABLE_SVG_PREVIEW && canonicalLanguage(language) === 'svg';

  useEffect(() => {
    if (isNested) return;
    floatRef.classList.add('__accessory-code-box');
  }, [floatRef, isNested]);

  if (isNested) return null;

  return (
    <div
      className="md-code-box-header pointer-events-none fixed"
      ref={glueRef as React.RefObject<HTMLDivElement>}
    >
      <div className="text-muted-foreground/50 pointer-events-auto flex w-full content-center items-start justify-between p-1">
        <CodeLanguageSelector
          language={language}
          setLanguage={setLanguageOnNode}
          editor={editor}
        />
        <div className="flex h-full items-center">
          {showPreviewToggle && (
            <div className="mr-2 flex items-center gap-2">
              <div className="text-muted-foreground/50 text-xs">
                {labels.preview}
              </div>
              <PreviewToggle
                checked={isPreviewMode}
                onChange={setIsPreviewMode}
              />
            </div>
          )}
          {editor.isEditable() && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground/50 hover:text-destructive h-full"
              title={labels.deleteCode}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                deleteCodeNode(editor, nodeKey);
              }}
            >
              <Trash2Icon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground/50 h-full"
            title={labels.copyCode}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              copyToClipboard(readCode());
            }}
          >
            <CopyIcon />
          </Button>
        </div>
      </div>
      {isPreviewMode && showPreviewToggle && (
        <SvgPreview svgContent={readCode()} overlay labels={labels} />
      )}
    </div>
  );
}

function sanitizeSvg(content: string): string {
  // Remove potentially dangerous elements/attributes
  return content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');
}

function SvgPreview({
  svgContent,
  overlay: _overlay,
  labels = defaultCodeBoxAccessoryLabels,
}: {
  svgContent: string;
  overlay?: boolean;
  labels?: CodeBoxAccessoryLabels;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trimmed = svgContent.trim();
  const isSvg = trimmed.toLowerCase().includes('<svg');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    for (const svg of container.querySelectorAll('svg')) {
      svg.style.maxWidth = '100%';
      svg.style.maxHeight = '100%';
      svg.style.width = 'auto';
      svg.style.height = 'auto';
      svg.style.display = 'block';
      svg.style.margin = 'auto';
    }
  }, [svgContent]);

  return (
    <div className="absolute inset-x-0 top-12 bottom-0 z-10 p-2">
      {!trimmed && (
        <div className="text-muted-foreground/50 flex h-full items-center justify-center text-sm">
          {labels.svgEmpty}
        </div>
      )}
      {trimmed && !isSvg && (
        <div className="text-destructive flex h-full items-center justify-center text-sm">
          {labels.svgInvalid}
        </div>
      )}
      {trimmed && isSvg && (
        <div className="size-full overflow-hidden p-2">
          <div
            ref={containerRef}
            className="flex size-full min-h-0 items-center justify-center"
            // The content is sanitized above; this mirrors the origin's
            // inline-SVG render path, which has no React-safe equivalent.
            dangerouslySetInnerHTML={{ __html: sanitizeSvg(svgContent) }}
          />
        </div>
      )}
    </div>
  );
}

export function StaticCodeBoxAccessory({
  language: languageProp,
  code,
  isPreviewMode: isPreviewModeProp,
  setIsPreviewMode: setIsPreviewModeProp,
  labels = defaultCodeBoxAccessoryLabels,
}: {
  language: string;
  code: string;
  theme?: EditorThemeClasses;
  isPreviewMode?: boolean;
  setIsPreviewMode?: (enabled: boolean) => void;
  labels?: CodeBoxAccessoryLabels;
}) {
  const [localPreviewMode, setLocalPreviewMode] = useState(false);

  // Use props if provided, otherwise fall back to local state
  const isPreviewMode = isPreviewModeProp ?? localPreviewMode;
  const setIsPreviewMode = setIsPreviewModeProp ?? setLocalPreviewMode;

  const language = canonicalLanguage(languageProp);
  const showPreviewToggle = ENABLE_SVG_PREVIEW && language === 'svg';

  return (
    <>
      <div
        className={cn(
          'md-code-box-header pointer-events-auto absolute top-0 left-0 flex w-full content-center items-center justify-between p-1 select-none',
          'text-muted-foreground/50'
        )}
      >
        <StaticLabel language={language} />
        <div className="flex items-center gap-2">
          {showPreviewToggle && (
            <div className="flex items-center gap-2">
              <div className="text-muted-foreground/50 text-xs">
                {labels.preview}
              </div>
              <PreviewToggle
                checked={isPreviewMode}
                onChange={setIsPreviewMode}
              />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground/50 h-full"
            title={labels.copyCode}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              copyToClipboard(code);
            }}
          >
            <CopyIcon />
          </Button>
        </div>
      </div>
      {isPreviewMode && showPreviewToggle && (
        <SvgPreview svgContent={code} overlay={false} />
      )}
    </>
  );
}
