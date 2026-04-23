export const AUTHOR_MEDIA_MIME_TYPES = [
  'image/*',
  'text/*',
  'audio/*',
  'video/*',
] as const;

export const AUTHOR_ARCHIVE_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-tar',
] as const;

export type AuthorMediaKind = 'image' | 'text' | 'audio' | 'video';
export type AuthorMediaDeliveryMode = 'inline' | 'stream';

function matchesMimePattern(mimeType: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    return mimeType.startsWith(pattern.slice(0, -1));
  }

  return mimeType === pattern;
}

export function isAllowedAuthorMediaMimeType(mimeType: string): boolean {
  return AUTHOR_MEDIA_MIME_TYPES.some((pattern) =>
    matchesMimePattern(mimeType, pattern)
  );
}

export function isArchiveMimeType(mimeType: string): boolean {
  return AUTHOR_ARCHIVE_MIME_TYPES.includes(
    mimeType as (typeof AUTHOR_ARCHIVE_MIME_TYPES)[number]
  );
}

export function resolveAuthorMediaKind(
  mimeType: string
): AuthorMediaKind | null {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('text/')) {
    return 'text';
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  return null;
}

export function resolveAuthorMediaDeliveryMode(
  kind: AuthorMediaKind
): AuthorMediaDeliveryMode {
  switch (kind) {
    case 'audio':
    case 'video':
      return 'stream';
    case 'image':
    case 'text':
      return 'inline';
  }
}
