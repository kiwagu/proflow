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
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
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
