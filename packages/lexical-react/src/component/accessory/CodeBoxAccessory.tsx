/**
 * @file The accessory rendered for code nodes — a copy button and a syntax
 * highlighting language selector.
 */
import { $isCodeNode, CodeNode } from '@lexical/code';
import {
  $isCustomCodeNode,
  LanguageDefinitions,
  normalizedLanguage,
  type SupportedLanguage,
} from '@workspace/lexical-nodes';
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

type IconComponent = FC<{ className?: string }>;

const LanguageIcons: Record<SupportedLanguage, IconComponent> = {
  plaintext: FileTextIcon,
  javascript: FileCodeIcon,
  typescript: FileTypeIcon,
  json: BracesIcon,
  python: FileCode2Icon,
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
  bash: FileCodeIcon,
  svg: FileCodeIcon,
};

function StaticLabel({ language }: { language: SupportedLanguage }) {
  const Icon = LanguageIcons[language];
  return (
    <div className="text-muted-foreground/50 flex items-center gap-1 p-2 font-sans text-xs font-medium">
      <Icon className="size-4" />
      <span className="select-none">{LanguageDefinitions[language].label}</span>
    </div>
  );
}

function validLanguage(language: string | null): SupportedLanguage {
  if (language && language.toLowerCase() in LanguageDefinitions) {
    return language.toLowerCase() as SupportedLanguage;
  }
  return 'plaintext';
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
  const current = validLanguage(language);
  const CurrentIcon = LanguageIcons[current];

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
          <CurrentIcon className="size-4" />
          <span>{LanguageDefinitions[current].label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          {Object.entries(LanguageDefinitions)
            .filter(([, info]) => info.show)
            .map(([key, info]) => {
              const Icon =
                LanguageIcons[key as SupportedLanguage] ??
                LanguageIcons.plaintext;
              return (
                <DropdownMenuItem
                  key={key}
                  onSelect={() => {
                    setLanguage(key);
                  }}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{info.label}</span>
                </DropdownMenuItem>
              );
            })}
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
}: {
  floatRef: HTMLElement;
  editor: LexicalEditor;
  nodeKey: NodeKey;
}) {
  const [language, setLanguage] = useState('JavaScript');
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Both hooks run unconditionally; the origin's short-circuit would make the
  // second one conditional, which React forbids.
  const inBlock = useIsInBlock();
  const nestedBlock = useIsNestedBlock();
  const isNested = inBlock && nestedBlock;
  const glueRef = useGlueToElement(editor, isNested ? null : floatRef);

  useAutoRegister(ENABLE_SVG_PREVIEW ? editor : undefined, (editorInstance) =>
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
              if ($isCustomCodeNode(node)) {
                setIsPreviewMode(node.getPreviewEnabled());
              }
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
      if (!$isCustomCodeNode(node)) return;
      node.setLanguage(next);
      setIsPreviewMode(node.getPreviewEnabled());
    });
  };

  const setPreviewModeOnNode = (enabled: boolean) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isCustomCodeNode(node)) return;
      node.setPreviewEnabled(enabled);
    });
  };

  const showPreviewToggle =
    ENABLE_SVG_PREVIEW && language.toLowerCase() === 'svg';

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
              <div className="text-muted-foreground/50 text-xs">Preview</div>
              <PreviewToggle
                checked={isPreviewMode}
                onChange={(enabled) => {
                  setIsPreviewMode(enabled);
                  setPreviewModeOnNode(enabled);
                }}
              />
            </div>
          )}
          {editor.isEditable() && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground/50 hover:text-destructive h-full"
              title="Delete Code"
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
            title="Copy Code"
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
        <SvgPreview svgContent={readCode()} overlay />
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
}: {
  svgContent: string;
  overlay?: boolean;
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
          No SVG content
        </div>
      )}
      {trimmed && !isSvg && (
        <div className="text-destructive flex h-full items-center justify-center text-sm">
          Invalid SVG content
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
}: {
  language: string;
  code: string;
  theme?: EditorThemeClasses;
  isPreviewMode?: boolean;
  setIsPreviewMode?: (enabled: boolean) => void;
}) {
  const [localPreviewMode, setLocalPreviewMode] = useState(false);

  // Use props if provided, otherwise fall back to local state
  const isPreviewMode = isPreviewModeProp ?? localPreviewMode;
  const setIsPreviewMode = setIsPreviewModeProp ?? setLocalPreviewMode;

  const language = normalizedLanguage(languageProp);
  const showPreviewToggle =
    ENABLE_SVG_PREVIEW && language.toLowerCase() === 'svg';

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
              <div className="text-muted-foreground/50 text-xs">Preview</div>
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
            title="Copy Code"
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
