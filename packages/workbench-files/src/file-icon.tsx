'use client';

import type { FileNode } from '@workspace/domain';
import { cn } from '@workspace/ui/lib/utils';
import {
  File as FileGeneric,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  type LucideIcon,
} from 'lucide-react';
import { categoryOf, type FileCategory } from './file-tree.js';

type IconKey = FileCategory | 'folder' | 'document';

/**
 * Per-kind icon and colour. The tone classes are theme tokens, so the
 * explorer reads the same in light and dark without a second table.
 */
const ICONS: Record<IconKey, { icon: LucideIcon; tone: string }> = {
  folder: { icon: Folder, tone: 'text-sky-600 dark:text-sky-400' },
  document: { icon: FileText, tone: 'text-primary' },
  image: { icon: FileImage, tone: 'text-violet-600 dark:text-violet-400' },
  video: { icon: FileVideo, tone: 'text-rose-600 dark:text-rose-400' },
  audio: { icon: FileAudio, tone: 'text-rose-600 dark:text-rose-400' },
  pdf: { icon: FileType, tone: 'text-red-600 dark:text-red-400' },
  text: { icon: FileCode, tone: 'text-emerald-600 dark:text-emerald-400' },
  archive: { icon: FileArchive, tone: 'text-muted-foreground' },
  word: { icon: FileText, tone: 'text-blue-600 dark:text-blue-400' },
  sheet: {
    icon: FileSpreadsheet,
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  unknown: { icon: FileGeneric, tone: 'text-muted-foreground' },
};

export function iconKeyOf(node: Pick<FileNode, 'kind' | 'mime'>): IconKey {
  if (node.kind === 'folder') return 'folder';
  if (node.kind === 'document') return 'document';
  return categoryOf(node.mime);
}

/** The explorer's per-kind icon, in the file type's colour. */
export function FileIcon({
  node,
  className,
}: {
  node: Pick<FileNode, 'kind' | 'mime'>;
  className?: string;
}) {
  const key = iconKeyOf(node);
  const entry = ICONS[key];
  const Icon = entry.icon;
  return (
    <Icon
      aria-hidden
      data-testid="file-icon"
      data-icon={key}
      className={cn('size-4 shrink-0', entry.tone, className)}
    />
  );
}
