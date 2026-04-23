import { describe, expect, it } from 'vitest';

import {
  isArchiveMimeType,
  isAllowedAuthorMediaMimeType,
  resolveAuthorMediaDeliveryMode,
  resolveAuthorMediaKind,
} from '@/collections/media.contract';

describe('author media contract', () => {
  it('accepts the current baseline MIME families', () => {
    expect(isAllowedAuthorMediaMimeType('image/png')).toBe(true);
    expect(isAllowedAuthorMediaMimeType('text/plain')).toBe(true);
    expect(isAllowedAuthorMediaMimeType('audio/mpeg')).toBe(true);
    expect(isAllowedAuthorMediaMimeType('video/mp4')).toBe(true);
  });

  it('rejects MIME families outside the current baseline', () => {
    expect(isAllowedAuthorMediaMimeType('application/pdf')).toBe(false);
    expect(isAllowedAuthorMediaMimeType('application/zip')).toBe(false);
  });

  it('classifies archive MIME types as explicitly unsupported', () => {
    expect(isArchiveMimeType('application/zip')).toBe(true);
    expect(isArchiveMimeType('application/gzip')).toBe(true);
    expect(isArchiveMimeType('application/x-tar')).toBe(true);
    expect(isArchiveMimeType('video/mp4')).toBe(false);
  });

  it('derives media kind from MIME type', () => {
    expect(resolveAuthorMediaKind('image/webp')).toBe('image');
    expect(resolveAuthorMediaKind('text/markdown')).toBe('text');
    expect(resolveAuthorMediaKind('audio/ogg')).toBe('audio');
    expect(resolveAuthorMediaKind('video/mp4')).toBe('video');
    expect(resolveAuthorMediaKind('application/pdf')).toBeNull();
  });

  it('derives delivery mode from media kind', () => {
    expect(resolveAuthorMediaDeliveryMode('image')).toBe('inline');
    expect(resolveAuthorMediaDeliveryMode('text')).toBe('inline');
    expect(resolveAuthorMediaDeliveryMode('audio')).toBe('stream');
    expect(resolveAuthorMediaDeliveryMode('video')).toBe('stream');
  });
});
