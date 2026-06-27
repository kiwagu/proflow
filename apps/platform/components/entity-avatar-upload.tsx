'use client';

import { ImageUpload } from '@workspace/ui/components/image-upload';

import { buildAvatarObjectPath, MEDIA_BUCKET } from '@/lib/media-avatar';
import { createClient } from '@/lib/supabase/client';

type EntityAvatarUploadProps = {
  value?: string;
  onChange?: (url: string) => void;
  entityId: string;
  scopePrefix: string;
  nestedPath?: string;
  disabled?: boolean;
};

export function EntityAvatarUpload({
  value,
  onChange,
  entityId,
  scopePrefix,
  nestedPath,
  disabled = false,
}: EntityAvatarUploadProps) {
  const handleUpload = async (file: File) => {
    const supabase = createClient();
    const fileExt = file.name.split('.').pop();
    const fileName = `${entityId}-${Date.now()}.${fileExt}`;
    const filePath = buildAvatarObjectPath(
      scopePrefix,
      entityId,
      fileName,
      nestedPath
    );

    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      // No upsert: `upsert: true` makes storage emit INSERT … ON CONFLICT …
      // RETURNING *, which Postgres checks against a SELECT policy on
      // storage.objects — and the 2026-06-27 advisor hardening dropped the media
      // SELECT policy, so upsert now fails RLS (42501). A plain INSERT needs no
      // SELECT. filePath is timestamp-unique anyway, so upsert was never needed.
      .upload(filePath, file, {
        cacheControl: '3600',
      });

    if (error) {
      throw error;
    }

    const { data: publicUrlData } = supabase.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(filePath);

    return publicUrlData.publicUrl;
  };

  return (
    <ImageUpload
      value={value}
      onChange={onChange}
      onUpload={handleUpload}
      disabled={disabled}
    />
  );
}
